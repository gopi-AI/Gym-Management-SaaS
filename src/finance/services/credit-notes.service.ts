import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreditNote } from '../entities/credit-note.entity';
import { CreateCreditNoteDto } from '../dto/create-credit-note.dto';
import { QueryCreditNoteDto } from '../dto/query-credit-note.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { InvoicesService } from './invoices.service';
import {
  CREDIT_NOTE_STATUS,
  FINANCE_EVENT_TYPES,
  FINANCE_EVENT_VERSION,
  INVOICE_STATUS,
  toMoney,
} from '../finance.constants';

/**
 * Structural mirror of `CreditNoteIssuedPayload` in
 * `packages/contracts/src/events/finance.events.ts`.
 */
interface CreditNoteIssuedPayloadShape extends Record<string, unknown> {
  creditNoteId: string;
  invoiceId: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  reason: string;
  issuedDate: string;
  status: string;
}

/**
 * P3-02 — credit notes against invoices (`docs/phase3-scoping-plan.md` §2).
 *
 * A credit note attaches to an INVOICE, not a payment: the invoice is reduced
 * without money moving. It therefore has no gateway involvement and no `pending`
 * state — it is `issued` when written.
 *
 * ## Model A: the invoice status is never rewritten (§15 Q5 ruling)
 *
 * A fully credited invoice is NOT transitioned to a `credited` state.
 * `VALID_INVOICE_TRANSITIONS` and `voidInvoice()`'s paid guard are untouched, and
 * the credit is expressed in exactly one place: the invoice's **derived**
 * outstanding balance, which `InvoicesService` computes as
 * `total_amount - paid - credited`. That keeps Phase 1 behaviour and its tests
 * intact and preserves the derived-balance pattern the finance module already uses.
 *
 * ## Tax reversal: the credit note carries its own breakdown (§15 Q5 ruling)
 *
 * `FINANCE_TAX_LINES` is **never written to and never changed** by a credit note.
 * It is the immutable audit record of the tax applied to each invoice line.
 * Instead the credit note stores its own `net_amount` / `tax_amount` /
 * `gross_amount`, computed at creation time from the invoice's own applied tax
 * ratio — see `splitCredit`.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    @InjectRepository(CreditNote)
    private readonly creditNoteRepository: Repository<CreditNote>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
    private readonly invoicesService: InvoicesService,
  ) {}

  /** Authorized organization, mirroring InvoicesService.resolveAuthorizedOrg. */
  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) return currentOrgId;
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) throw new ForbiddenException('Organization context required');
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /**
   * Total already credited against an invoice, counting only credit notes that
   * still stand. A `voided` credit note no longer reduces the balance, so it must
   * not consume any of the creditable amount either.
   */
  private static async creditedTotal(
    manager: EntityManager,
    organizationId: string,
    invoiceId: string,
  ): Promise<string> {
    const row: { credited: string } | undefined = await manager
      .getRepository(CreditNote)
      .createQueryBuilder('creditNote')
      .select('COALESCE(SUM(creditNote.gross_amount), 0)', 'credited')
      .where('creditNote.organization_id = :organizationId', { organizationId })
      .andWhere('creditNote.invoice_id = :invoiceId', { invoiceId })
      .andWhere('creditNote.status = :status', { status: CREDIT_NOTE_STATUS.ISSUED })
      .getRawOne();
    return toMoney(row?.credited ?? 0);
  }

  /**
   * Split a gross credit into its net and tax parts using the invoice's OWN
   * applied tax ratio (`invoiceTaxAmount / invoiceTotalAmount`).
   *
   * Reading the ratio off the invoice rather than looking up a tax rate means the
   * reversal cannot disagree with what was actually charged: the invoice is the
   * record of what was applied. It also needs no rate lookup, so a credit note
   * still works against an invoice raised under a rate that has since been
   * changed, deleted or expired — which a live rate lookup would get wrong.
   *
   * Rounding is applied ONCE to the tax part and `net` is DERIVED from it, so
   * `net + tax === gross` exactly and the
   * `CHK_finance_credit_notes_amounts_balance` constraint is always satisfiable.
   * Same discipline as `computeLineTax`.
   */
  static splitCredit(
    amount: string,
    invoiceTaxAmount: string,
    invoiceTotalAmount: string,
  ): { net: string; tax: string } {
    const gross = toMoney(amount);
    const total = Number(invoiceTotalAmount);
    const tax = Number(invoiceTaxAmount);

    // No tax was applied — every Phase 1 invoice, and any invoice whose lines
    // carried no `tax_code`. The credit is entirely net, so a credit note against
    // an untaxed invoice behaves exactly as it did before tax existed.
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(tax) || tax <= 0) {
      return { net: gross, tax: toMoney(0) };
    }

    const taxPart = toMoney((Number(gross) * tax) / total);
    // A ratio can round the tax part above the credit itself on a very small
    // credit against a heavily-taxed invoice. Clamping keeps `net >= 0` and keeps
    // gross = net + tax true, rather than emitting a negative net amount.
    const clampedTax = Number(taxPart) > Number(gross) ? gross : taxPart;
    return { net: toMoney(Number(gross) - Number(clampedTax)), tax: clampedTax };
  }

  /**
   * Issue a credit note against an invoice (`POST /v1/invoices/{id}/credit-notes`).
   *
   * One transaction on a row-locked invoice:
   *   1. load the invoice scoped to the authorized org, `FOR UPDATE`;
   *   2. reject a voided invoice — it owes nothing, so there is nothing to credit;
   *   3. recompute the already-credited total from the credit notes table;
   *   4. reject anything exceeding the un-credited balance;
   *   5. derive the net/tax split from the invoice's own applied ratio;
   *   6. insert the credit note as `issued`;
   *   7. enqueue `CreditNoteIssued.v1` on the same transaction.
   *
   * The invoice's `status` is deliberately NOT touched (Model A). The credit
   * becomes visible through the derived outstanding balance instead.
   */
  async create(invoiceId: string, dto: CreateCreditNoteDto): Promise<CreditNote> {
    const organizationId = await this.resolveAuthorizedOrg();
    const amount = toMoney(dto.amount);

    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoicesService.loadInvoiceForUpdate(
        manager,
        invoiceId,
        organizationId,
      );

      if (invoice.status === INVOICE_STATUS.VOID) {
        throw new BadRequestException('A voided invoice cannot be credited');
      }

      const alreadyCredited = await CreditNotesService.creditedTotal(
        manager,
        organizationId,
        invoiceId,
      );
      const creditable = toMoney(Number(invoice.total_amount) - Number(alreadyCredited));

      if (Number(creditable) <= 0) {
        throw new BadRequestException('Invoice has already been fully credited');
      }
      if (Number(amount) > Number(creditable)) {
        throw new BadRequestException(
          `Credit amount ${amount} exceeds the un-credited balance ${creditable}`,
        );
      }

      const { net, tax } = CreditNotesService.splitCredit(
        amount,
        invoice.tax_amount,
        invoice.total_amount,
      );
      const issuedDate = dto.issued_date ? new Date(dto.issued_date) : new Date();
      const repository = manager.getRepository(CreditNote);

      const creditNote = await repository.save(
        repository.create({
          organization_id: organizationId,
          invoice_id: invoice.id,
          reason: dto.reason,
          net_amount: net,
          tax_amount: tax,
          // net + tax by construction, so the stored gross is exactly what the
          // invoice's outstanding balance is reduced by.
          gross_amount: amount,
          issued_date: issuedDate,
          status: CREDIT_NOTE_STATUS.ISSUED,
        }),
      );

      const payload: CreditNoteIssuedPayloadShape = {
        creditNoteId: creditNote.id,
        invoiceId: invoice.id,
        netAmount: creditNote.net_amount,
        taxAmount: creditNote.tax_amount,
        grossAmount: creditNote.gross_amount,
        reason: creditNote.reason,
        issuedDate: creditNote.issued_date.toISOString(),
        status: creditNote.status,
      };

      await this.outboxService.saveEventEnvelope(
        FINANCE_EVENT_TYPES.CREDIT_NOTE_ISSUED, // docs/event-contracts.md §CreditNoteIssued.v1
        FINANCE_EVENT_VERSION,
        organizationId,
        payload,
        invoice.id, // correlationId = invoice id (money trail of that invoice)
        undefined,
        manager, // transaction-scoped: atomic with the credit-note row
      );

      return creditNote;
    });
  }

  /** Paginated, tenant-scoped credit-note list (newest first). */
  async findAll(query: QueryCreditNoteDto): Promise<{
    data: CreditNote[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const where: Record<string, unknown> = { organization_id: organizationId };
    if (query.invoice_id) where.invoice_id = query.invoice_id;
    if (query.status) where.status = query.status;

    const [data, total] = await this.creditNoteRepository.findAndCount({
      where,
      order: { issued_date: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<CreditNote> {
    const organizationId = await this.resolveAuthorizedOrg();
    const creditNote = await this.creditNoteRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!creditNote) throw new NotFoundException('Credit note not found');
    return creditNote;
  }
}
