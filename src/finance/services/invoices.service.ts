import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, In } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { TaxLine } from '../entities/tax-line.entity';
import { InvoiceDiscount } from '../entities/invoice-discount.entity';
import { TaxRate } from '../entities/tax-rate.entity';
import { Payment } from '../entities/payment.entity';
import { CreditNote } from '../entities/credit-note.entity';
import { CreateInvoiceDto, InvoiceLineItemDto } from '../dto/create-invoice.dto';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { endOfRange } from '../../shared/utils/date-range';
import { InvoiceNumberService } from './invoice-number.service';
import { TaxRatesService } from './tax-rates.service';
import {
  CREDIT_NOTE_STATUS,
  FINANCE_EVENT_VERSION,
  FINANCE_EVENT_TYPES,
  INVOICE_STATUS,
  OUTSTANDING_INVOICE_STATUSES,
  PAYMENT_STATUS,
  TAX_EXEMPT_NAME,
  TaxedLineAmounts,
  computeInvoiceTotals,
  computeLineTax,
  toMoney,
  sumMoney,
} from '../finance.constants';

/**
 * Structural mirror of InvoiceCreatedPayload in
 * packages/contracts/src/events/finance.events.ts (which in turn mirrors
 * `docs/event-contracts.md` §Finance Events / `InvoiceCreated.v1`).
 */
interface InvoiceLineItemPayloadShape extends Record<string, unknown> {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  taxCode?: string;
}

interface InvoiceCreatedPayloadShape extends Record<string, unknown> {
  invoiceId: string;
  memberId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totalAmount: string;
  lineItems: InvoiceLineItemPayloadShape[];
}

/**
 * Input for the membership-sale hook. The caller (MembershipsService) already
 * holds the authoritative org/plan/member data, so this is a plain,
 * pre-validated input rather than a client DTO.
 */
export interface MembershipSaleInvoiceInput {
  organizationId: string;
  memberId: string;
  membershipId: string;
  branchId?: string;
  description: string;
  /** Plan price as a decimal string (MembershipPlan.price). */
  amount: string;
  discount?: {
    id: string;
    discount_type: 'fixed' | 'percentage';
    amount: string;
  };
  dueDate?: Date;
  /** Caller's transaction: the invoice must commit with the membership. */
  manager: EntityManager;
}

/** An invoice together with its lines, its applied tax and its derived payment balance. */
export interface InvoiceWithDetail {
  invoice: Invoice;
  items: InvoiceItem[];
  /** P3-04: one row per taxed line; empty for an untaxed invoice. */
  tax_lines: TaxLine[];
  amount_paid: string;
  /** P3-02: standing credit notes against this invoice, as a money string. */
  amount_credited: string;
  outstanding_amount: string;
}

export interface InvoiceListItem extends Invoice {
  amount_paid: string;
  outstanding_amount: string;
}

/** Default payment terms when the caller does not supply a due date. */
const DEFAULT_PAYMENT_TERM_DAYS = 14;

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepository: Repository<InvoiceItem>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(TaxLine)
    private readonly taxLineRepository: Repository<TaxLine>,
    // P3-02: credit notes are read through their own repository rather than
    // through `CreditNotesService`, because `CreditNotesService` already depends
    // on this service (`loadInvoiceForUpdate`) and injecting it here would make
    // the two depend on each other. The repository has no such cycle, and
    // `TaxLine` above is read the same way. The "what counts as a standing
    // credit" rule is shared with `CreditNotesService.creditedTotal` through
    // `CREDIT_NOTE_STATUS`, not duplicated as a literal.
    @InjectRepository(CreditNote)
    private readonly creditNoteRepository: Repository<CreditNote>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
    private readonly invoiceNumberService: InvoiceNumberService,
    // P3-04: rates are resolved through the service that owns the rates table, so
    // the invoice path never queries FINANCE_TAX_RATES directly and the
    // "which rates are in force" rule exists in exactly one place.
    private readonly taxRatesService: TaxRatesService,
  ) {}

  /** Authorized organization, mirroring MembershipsService.resolveAuthorizedOrg. */
  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) return currentOrgId;
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) throw new ForbiddenException('Organization context required');
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  private async ensureMemberBelongsToOrg(memberId: string, organizationId: string): Promise<void> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('1')
      .from('MEMBERS_MEMBERS', 'm')
      .where('m.id = :id AND m.organization_id = :orgId AND m.is_active = :active', {
        id: memberId,
        orgId: organizationId,
        active: true,
      })
      .getRawOne();
    if (!result) {
      throw new BadRequestException(
        'Member not found or does not belong to the authorized organization',
      );
    }
  }

  /**
   * P3-04 — is the member tax-exempt? (§15 Q7: the flag lives on the member.)
   *
   * Read inside the caller's transaction so the exemption used for the tax
   * calculation is the one committed with the invoice; reading through the ambient
   * repository could observe a concurrent PATCH and tax the invoice under a rule
   * that was never in force.
   *
   * A member row that has vanished between validation and this read is treated as
   * non-exempt: `ensureMemberBelongsToOrg` has already rejected a genuinely unknown
   * member, so reaching the fallback means the member was deleted mid-flight, and
   * the safe default for a tax decision is "no exemption" — charging tax that was
   * not owed is a recoverable billing error, whereas untaxed revenue is not.
   */
  private async isMemberTaxExempt(
    memberId: string,
    organizationId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    const row: { tax_exempt: boolean } | undefined = await manager
      .createQueryBuilder()
      .select('m.tax_exempt', 'tax_exempt')
      .from('MEMBERS_MEMBERS', 'm')
      .where('m.id = :id AND m.organization_id = :orgId', { id: memberId, orgId: organizationId })
      .getRawOne();
    return row?.tax_exempt === true;
  }

  private async ensureMembershipBelongsToOrg(
    membershipId: string,
    memberId: string,
    organizationId: string,
  ): Promise<void> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('1')
      .from('MEMBERSHIPS_MEMBERSHIPS', 'ms')
      .where('ms.id = :id AND ms.organization_id = :orgId AND ms.member_id = :memberId', {
        id: membershipId,
        orgId: organizationId,
        memberId,
      })
      .getRawOne();
    if (!result) {
      throw new BadRequestException(
        'Membership not found or does not belong to the authorized organization',
      );
    }
  }

  /**
   * Succeeded-payment totals keyed by invoice id. Public because
   * PaymentsService reuses it (with its own transaction manager) to recompute an
   * invoice's balance after inserting a payment, so the summation logic exists
   * in exactly one place.
   *
   * The amount paid is derived from payments rather than denormalised onto the
   * invoice, so `FINANCE_PAYMENTS` stays the single source of truth (the
   * database plan has no `amount_paid` column on invoices).
   *
   * `manager` MUST be the caller's transaction manager whenever the caller is
   * inside a transaction, otherwise the sum is read on a different connection and
   * cannot see the not-yet-committed payment row.
   */
  async paymentTotalsByInvoice(
    organizationId: string,
    invoiceIds: string[],
    manager?: EntityManager,
  ): Promise<Map<string, string>> {
    const totals = new Map<string, string>();
    if (invoiceIds.length === 0) return totals;

    const repository = manager ? manager.getRepository(Payment) : this.paymentRepository;
    const rows: Array<{ invoice_id: string; paid: string }> = await repository
      .createQueryBuilder('payment')
      .select('payment.invoice_id', 'invoice_id')
      .addSelect('SUM(payment.amount)', 'paid')
      .where('payment.organization_id = :organizationId', { organizationId })
      .andWhere('payment.status = :status', { status: PAYMENT_STATUS.SUCCEEDED })
      .andWhere('payment.invoice_id IN (:...invoiceIds)', { invoiceIds })
      .groupBy('payment.invoice_id')
      .getRawMany();

    for (const row of rows) {
      totals.set(row.invoice_id, toMoney(row.paid));
    }
    return totals;
  }

  /**
   * P3-02 — standing credit notes totalled per invoice: the credit counterpart of
   * `paymentTotalsByInvoice`, and deliberately shaped identically (same
   * signature, same `Map<invoiceId, moneyString>` return, same optional
   * `manager`) so the two are read and tested the same way.
   *
   * Only `issued` credit notes count — a `voided` one no longer reduces the
   * invoice. That is the same rule `CreditNotesService.creditedTotal` applies
   * when deciding how much of an invoice is still creditable, and the same rule
   * the P3-02 ledger views apply in SQL, so all three agree.
   *
   * `gross_amount`, not `net_amount`: the credit note reduces the invoice by its
   * gross (net + tax) amount, which is what the member owes less of.
   */
  async creditNoteTotalsByInvoice(
    organizationId: string,
    invoiceIds: string[],
    manager?: EntityManager,
  ): Promise<Map<string, string>> {
    const totals = new Map<string, string>();
    if (invoiceIds.length === 0) return totals;

    const repository = manager ? manager.getRepository(CreditNote) : this.creditNoteRepository;
    const rows: Array<{ invoice_id: string; credited: string }> = await repository
      .createQueryBuilder('creditNote')
      .select('creditNote.invoice_id', 'invoice_id')
      .addSelect('SUM(creditNote.gross_amount)', 'credited')
      .where('creditNote.organization_id = :organizationId', { organizationId })
      .andWhere('creditNote.status = :status', { status: CREDIT_NOTE_STATUS.ISSUED })
      .andWhere('creditNote.invoice_id IN (:...invoiceIds)', { invoiceIds })
      .groupBy('creditNote.invoice_id')
      .getRawMany();

    for (const row of rows) {
      totals.set(row.invoice_id, toMoney(row.credited));
    }
    return totals;
  }

  /**
   * The invoice's derived balance under §15 Q5's Model A ruling.
   *
   * `credited` is a REQUIRED argument rather than an optional `'0.00'` default.
   * That is deliberate: every caller has to decide what it knows about credit
   * notes instead of silently inheriting a payments-only balance by forgetting
   * to pass one, which is exactly how the Model A gap would reappear.
   *
   * PUBLIC because `PaymentsService` is the other caller that needs this number.
   * The over-payment ceiling it enforces and the `outstanding_amount` this service
   * reports are the same question asked in two places, so they must be the same
   * expression: if they were derived separately, a payment could be refused
   * against a balance the API was simultaneously advertising as payable.
   * `creditNoteTotalsByInvoice` supplies the credits; this stays the single place
   * the subtraction happens.
   *
   * The result is floored at zero, so a caller asking "is anything still owed?"
   * tests `<= 0` rather than comparing an amount sum to the total.
   */
  public static outstanding(total: string, paid: string, credited: string): string {
    return toMoney(Math.max(0, Number(total) - Number(paid) - Number(credited)));
  }

  /** Paginated invoice list (tenant-scoped, newest first). */
  async findAll(query: QueryInvoiceDto): Promise<{
    data: InvoiceListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const qb = this.invoiceRepository
      .createQueryBuilder('invoice')
      .where('invoice.organization_id = :organizationId', { organizationId });

    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    } else if (query.outstanding_only) {
      qb.andWhere('invoice.status IN (:...statuses)', {
        statuses: OUTSTANDING_INVOICE_STATUSES,
      });
    }
    if (query.member_id) {
      qb.andWhere('invoice.member_id = :memberId', { memberId: query.member_id });
    }
    if (query.membership_id) {
      qb.andWhere('invoice.membership_id = :membershipId', {
        membershipId: query.membership_id,
      });
    }
    if (query.branch_id) {
      qb.andWhere('invoice.branch_id = :branchId', { branchId: query.branch_id });
    }
    if (query.from) {
      qb.andWhere('invoice.invoice_date >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('invoice.invoice_date <= :to', { to: endOfRange(query.to) });
    }

    const [rows, total] = await qb
      .orderBy('invoice.invoice_date', 'DESC')
      .addOrderBy('invoice.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const totals = await this.paymentTotalsByInvoice(
      organizationId,
      rows.map((invoice) => invoice.id),
    );
    // P3-02: credits for the same page of invoices, fetched in one query so the
    // list's balance is correct without an N+1 — the same reason the paid totals
    // above are fetched in bulk rather than per row.
    const credits = await this.creditNoteTotalsByInvoice(
      organizationId,
      rows.map((invoice) => invoice.id),
    );

    const data: InvoiceListItem[] = rows.map((invoice) => {
      const paid = totals.get(invoice.id) ?? '0.00';
      const credited = credits.get(invoice.id) ?? '0.00';
      return {
        ...invoice,
        amount_paid: paid,
        outstanding_amount: InvoicesService.outstanding(invoice.total_amount, paid, credited),
      };
    });

    return { data, total, page, limit };
  }

  /** Single invoice with its line items and derived balance. */
  async findOne(id: string): Promise<InvoiceWithDetail> {
    const organizationId = await this.resolveAuthorizedOrg();

    const invoice = await this.invoiceRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const items = await this.invoiceItemRepository.find({
      where: { invoice_id: invoice.id, organization_id: organizationId },
    });
    // FINANCE_INVOICE_ITEMS has no ordering column, so lines are presented in a
    // stable alphabetical order instead of an arbitrary database order.
    items.sort((a, b) => a.description.localeCompare(b.description));

    const totals = await this.paymentTotalsByInvoice(organizationId, [invoice.id]);
    const amountPaid = totals.get(invoice.id) ?? '0.00';
    // P3-02: a credited invoice must not report the un-credited balance (§15 Q5
    // Model A — the credit lives in the derived balance, not in `status`).
    const credits = await this.creditNoteTotalsByInvoice(organizationId, [invoice.id]);
    const amountCredited = credits.get(invoice.id) ?? '0.00';

    // P3-04: the applied tax is returned alongside the lines so a caller can see
    // WHY the header's tax_amount is what it is. §4 requires the applied result to
    // be recorded; reading it back is what makes that record useful. Scoped by
    // `invoice_item_id IN (...)` rather than by organization, so the query touches
    // only this invoice's rows.
    const taxLines =
      items.length === 0
        ? []
        : await this.taxLineRepository.find({
            where: {
              organization_id: organizationId,
              invoice_item_id: In(items.map((item) => item.id)),
            },
            order: { tax_name: 'ASC' },
          });

    return {
      invoice,
      items,
      tax_lines: taxLines,
      amount_paid: amountPaid,
      amount_credited: amountCredited,
      outstanding_amount: InvoicesService.outstanding(
        invoice.total_amount,
        amountPaid,
        amountCredited,
      ),
    };
  }

  /**
   * Load an invoice for update inside the caller's transaction.
   *
   * The row is locked (`pessimistic_write`) so concurrent payment recordings on
   * the same invoice serialize and cannot both read a stale balance.
   */
  async loadInvoiceForUpdate(
    manager: EntityManager,
    invoiceId: string,
    organizationId: string,
  ): Promise<Invoice> {
    const invoice = await manager.getRepository(Invoice).findOne({
      where: { id: invoiceId, organization_id: organizationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  /**
   * Create an invoice explicitly (`POST /v1/invoices`).
   *
   * The invoice row, its line items and its `InvoiceCreated` event are written in
   * ONE transaction, so an invoice can never exist without its lines or without
   * the event that downstream consumers rely on.
   */
  async create(dto: CreateInvoiceDto): Promise<InvoiceWithDetail> {
    const organizationId = await this.resolveAuthorizedOrg();
    await this.ensureMemberBelongsToOrg(dto.member_id, organizationId);
    if (dto.membership_id) {
      await this.ensureMembershipBelongsToOrg(dto.membership_id, dto.member_id, organizationId);
    }
    if (dto.branch_id) {
      const ok = await this.tenantContextService.validateBranchAccess(organizationId, dto.branch_id);
      if (!ok) {
        throw new BadRequestException('Branch does not belong to the authorized organization');
      }
    }

    // `issue: false` deliberately holds the invoice as a draft; anything else is
    // issued immediately (see the CreateInvoiceDto docblock).
    const issue = dto.issue !== false;
    const dueDate = dto.due_date ? new Date(dto.due_date) : InvoicesService.defaultDueDate();

    const detail = await this.dataSource.transaction((manager) =>
      this.persistInvoice(manager, {
        organizationId,
        memberId: dto.member_id,
        membershipId: dto.membership_id,
        branchId: dto.branch_id,
        lineItems: dto.line_items,
        status: issue ? INVOICE_STATUS.SENT : INVOICE_STATUS.DRAFT,
        dueDate,
      }),
    );

    const totals = await this.paymentTotalsByInvoice(organizationId, [detail.invoice.id]);
    const amountPaid = totals.get(detail.invoice.id) ?? '0.00';

    // P3-02: an invoice created moments ago in this same transaction cannot have
    // a credit note against it, so the credited total is a known '0.00' and no
    // query is issued for it. Reading it would be a round trip that can only ever
    // return zero.
    const amountCredited = toMoney(0);

    return {
      invoice: detail.invoice,
      items: detail.items,
      tax_lines: detail.taxLines,
      amount_paid: amountPaid,
      amount_credited: amountCredited,
      outstanding_amount: InvoicesService.outstanding(
        detail.invoice.total_amount,
        amountPaid,
        amountCredited,
      ),
    };
  }

  /**
   * Generate the invoice for a membership sale.
   *
   * Called by MembershipsService INSIDE its own transaction (`input.manager`):
   * the invoice, its line item and the `InvoiceCreated` event commit — or roll
   * back — together with the membership, so a failed sale can never leave an
   * orphan invoice or a phantom charge behind.
   *
   * The invoice is created `sent` because it is issued at the point of sale and
   * handed to the member at the desk. Phase 1 has no asynchronous delivery step,
   * so parking a sale invoice in `draft` would make it permanently unpayable.
   */
  async createForMembershipSale(
    input: MembershipSaleInvoiceInput,
  ): Promise<{ invoice: Invoice; items: InvoiceItem[]; taxLines: TaxLine[] }> {
    const price = Number(input.amount);
    const discountAmount = input.discount
      ? input.discount.discount_type === 'percentage'
        ? Math.min(price, price * Number(input.discount.amount) / 100)
        : Math.min(price, Number(input.discount.amount))
      : 0;
    const netAmount = toMoney(price - discountAmount);
    return this.persistInvoice(input.manager, {
      organizationId: input.organizationId,
      memberId: input.memberId,
      membershipId: input.membershipId,
      branchId: input.branchId,
      lineItems: [
        {
          description: input.description,
          quantity: 1,
          unit_price: Number(netAmount),
        },
      ],
      status: INVOICE_STATUS.SENT,
      // A counter sale is due on receipt, not on 14-day terms.
      dueDate: input.dueDate ?? new Date(),
      causationId: input.membershipId,
      discount: input.discount ? { ...input.discount, applied_amount: toMoney(discountAmount) } : undefined,
    });
  }

  /**
   * Void an invoice (`POST /v1/invoices/{id}/void`).
   *
   * Only invoices with nothing collected against them can be voided. A partially
   * paid invoice would require a refund of the money already taken, and refunds
   * are out of scope for this pass — so that transition is rejected explicitly
   * rather than silently discarding a member's payment.
   *
   * The two guards below are P3-02's "debt repayment" (§2 required that they
   * "point at real functionality instead of 'out of scope'"). The guards
   * themselves are UNCHANGED — voiding a paid or partly-paid invoice still moves
   * no money back, so it is still rejected — but the messages now name the
   * endpoints that do the job.
   *
   * Still open, deliberately: voiding a PARTIALLY PAID invoice remains
   * unsupported, and no `InvoiceVoided` event exists in
   * `docs/event-contracts.md`. `RefundIssued` / `CreditNoteIssued` now exist, but
   * neither expresses a void, and inventing a contract here would be inventing an
   * event no consumer has asked for.
   */
  async voidInvoice(id: string): Promise<Invoice> {
    const organizationId = await this.resolveAuthorizedOrg();

    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.loadInvoiceForUpdate(manager, id, organizationId);

      if (invoice.status === INVOICE_STATUS.VOID) {
        throw new BadRequestException('Invoice is already void');
      }
      if (invoice.status === INVOICE_STATUS.PAID) {
        throw new BadRequestException(
          'A paid invoice cannot be voided; issue a refund against the payment ' +
            '(POST /v1/payments/{id}/refunds) or a credit note against this invoice ' +
            '(POST /v1/invoices/{id}/credit-notes) instead',
        );
      }

      const totals = await this.paymentTotalsByInvoice(organizationId, [invoice.id], manager);
      const amountPaid = totals.get(invoice.id) ?? '0.00';
      if (Number(amountPaid) > 0) {
        throw new BadRequestException(
          `Invoice already has ${amountPaid} collected against it; refund the payment or issue a credit note before voiding it`,
        );
      }

      await manager
        .getRepository(Invoice)
        .update({ id: invoice.id, organization_id: organizationId }, { status: INVOICE_STATUS.VOID });

      return { ...invoice, status: INVOICE_STATUS.VOID };
    });
  }

  /**
   * P3-04 — resolve tax for every line and roll the invoice totals up.
   *
   * Replaces the Phase 1 `computeTotals` stub that always returned `0.00` tax.
   * The arithmetic itself is NOT here: it is `computeLineTax` /
   * `computeInvoiceTotals` in `finance.constants.ts`, next to `toMoney()` /
   * `sumMoney()`, because §4 requires all money arithmetic to round to 2 decimals
   * in exactly one place.
   *
   * Backwards compatibility (§4): a line with NO `tax_code` is not taxed and
   * produces no tax row, so every Phase 1 caller keeps producing `tax_amount =
   * 0.00` byte-for-byte. A line WITH a `tax_code` that does not resolve to an
   * active rate is REJECTED rather than treated as zero-rated — see
   * `TaxRatesService.resolveActiveRates`.
   *
   * Exemption (§15 Q7) is per member, so it is applied to every line at once. An
   * exempt member still gets a tax row per taxed line, with `tax_rate` and
   * `tax_amount` both `0.00` and `tax_name` `Tax exempt`, because §4 requires that
   * "a zero-rated line is a real audit row, not a missing one".
   */
  private static async computeTaxedLines(
    organizationId: string,
    lineItems: InvoiceLineItemDto[],
    isMemberTaxExempt: boolean,
    at: Date,
    manager: EntityManager,
    taxRatesService: TaxRatesService,
  ): Promise<{ lines: TaxedLineAmounts[]; taxLines: Array<{ lineIndex: number; taxLine: Partial<TaxLine> }> }> {
    const requestedCodes = lineItems.map((line) => line.tax_code ?? '');
    const rates = await taxRatesService.resolveActiveRates(
      organizationId,
      requestedCodes,
      at,
      manager,
    );

    const unresolved = TaxRatesService.unresolvedCodes(requestedCodes, rates);
    if (unresolved.length > 0) {
      throw new BadRequestException(
        `Unknown or inactive tax_code(s): ${unresolved.join(', ')}`,
      );
    }

    const lines: TaxedLineAmounts[] = [];
    // Paired with the index of the line item it belongs to: a tax row cannot be
    // written until its invoice item has an id, so the association is resolved
    // after the items are saved rather than guessed from array positions.
    const taxLines: Array<{ lineIndex: number; taxLine: Partial<TaxLine> }> = [];

    for (const [lineIndex, line] of lineItems.entries()) {
      const lineTotal = Number(line.quantity) * Number(line.unit_price);
      const code = (line.tax_code ?? '').toUpperCase();
      const rate = code ? rates.get(code) : undefined;

      // No tax_code at all -> no tax row and no tax, preserving Phase 1 behaviour.
      if (!rate) {
        lines.push(computeLineTax({ lineTotal, ratePercent: 0, isInclusive: false }));
        continue;
      }

      const taxed = computeLineTax({
        lineTotal,
        ratePercent: rate.rate,
        isInclusive: rate.is_inclusive,
        isExempt: isMemberTaxExempt,
      });
      lines.push(taxed);

      taxLines.push({
        lineIndex,
        taxLine: {
          organization_id: organizationId,
          // The rate as APPLIED is snapshotted, never a live reference to the rate
          // row: editing a rate must not change an invoice already issued.
          tax_name: isMemberTaxExempt ? TAX_EXEMPT_NAME : rate.name,
          tax_rate: isMemberTaxExempt ? toMoney(0) : rate.rate,
          tax_amount: taxed.taxAmount,
        },
      });
    }

    return { lines, taxLines };
  }


  /** Default payment terms: due DEFAULT_PAYMENT_TERM_DAYS after issue. */
  private static defaultDueDate(from: Date = new Date()): Date {
    const due = new Date(from.getTime());
    due.setDate(due.getDate() + DEFAULT_PAYMENT_TERM_DAYS);
    return due;
  }

  /**
   * Write an invoice + its line items + its tax lines + its `InvoiceCreated` event
   * on the caller's transaction. Shared by the explicit and the sale-driven
   * creation paths so the two can never diverge.
   *
   * P3-04 adds tax in three places, all on this one transaction:
   *   1. the member's exemption is read inside the transaction (see
   *      `isMemberTaxExempt`), so the rule applied is the committed one;
   *   2. each line's tax is resolved and the invoice's `subtotal` / `tax_amount` /
   *      `total_amount` are computed from the PER-LINE results;
   *   3. a `FINANCE_TAX_LINES` row is written for every taxed line, after the items
   *      exist (a tax line references `invoice_item_id`).
   *
   * Because all four writes share this transaction, an invoice can never exist with
   * tax that does not reconcile against its tax lines — and a rejected tax_code
   * rolls back the whole invoice rather than leaving an untaxed one behind.
   */
  private async persistInvoice(
    manager: EntityManager,
    input: {
      organizationId: string;
      memberId: string;
      membershipId?: string;
      branchId?: string;
      lineItems: InvoiceLineItemDto[];
      status: string;
      dueDate: Date;
      causationId?: string;
      discount?: { id: string; discount_type: string; amount: string; applied_amount: string };
    },
  ): Promise<{ invoice: Invoice; items: InvoiceItem[]; taxLines: TaxLine[] }> {
    const invoiceDate = new Date();
    const memberTaxExempt = await this.isMemberTaxExempt(
      input.memberId,
      input.organizationId,
      manager,
    );

    const { lines, taxLines } = await InvoicesService.computeTaxedLines(
      input.organizationId,
      input.lineItems,
      memberTaxExempt,
      invoiceDate,
      manager,
      this.taxRatesService,
    );
    const { subtotal, taxAmount, totalAmount } = computeInvoiceTotals(lines);

    // Allocated on the caller's connection, under a row lock on the counter
    // (see InvoiceNumberService), so concurrent sales cannot share a number.
    const invoiceNumber = await this.invoiceNumberService.nextInvoiceNumber(
      input.organizationId,
      manager,
    );

    const invoiceRepository = manager.getRepository(Invoice);
    const invoiceItemRepository = manager.getRepository(InvoiceItem);

    const invoice = await invoiceRepository.save(
      invoiceRepository.create({
        organization_id: input.organizationId,
        branch_id: input.branchId ?? null,
        member_id: input.memberId,
        membership_id: input.membershipId ?? null,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: input.dueDate,
        subtotal,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        status: input.status,
        paid_at: null,
      }),
    );

    // `line_total` stays quantity x unit_price (the line amount as entered), which
    // is what Phase 1 wrote and what `InvoiceCreated.v1.lineItems[].lineTotal`
    // means. The tax separation is carried by the invoice's
    // subtotal/tax_amount/total_amount triple and by FINANCE_TAX_LINES, not by
    // rewriting the line amount — so an exclusive-rate invoice still has
    // sum(line_total) === subtotal, and an inclusive-rate one does not, which is
    // exactly the definition of inclusive tax.
    const items = await invoiceItemRepository.save(
      input.lineItems.map((line) =>
        invoiceItemRepository.create({
          invoice_id: invoice.id,
          organization_id: input.organizationId,
          description: line.description,
          quantity: toMoney(line.quantity),
          unit_price: toMoney(line.unit_price),
          line_total: toMoney(Number(line.quantity) * Number(line.unit_price)),
          tax_code: line.tax_code ?? null,
        }),
      ),
    );

    if (input.discount) {
      const discountRepository = manager.getRepository(InvoiceDiscount);
      await discountRepository.save(discountRepository.create({
        invoice_id: invoice.id,
        organization_id: input.organizationId,
        membership_discount_id: input.discount.id,
        discount_type: input.discount.discount_type,
        amount: toMoney(input.discount.amount),
        applied_amount: input.discount.applied_amount,
      }));
    }

    let savedTaxLines: TaxLine[] = [];
    if (taxLines.length > 0) {
      const taxLineRepository = manager.getRepository(TaxLine);
      savedTaxLines = await taxLineRepository.save(
        taxLines.map(({ lineIndex, taxLine }) =>
          taxLineRepository.create({
            ...taxLine,
            // Resolved here, not earlier: `invoice_item_id` only exists once the
            // items above have been saved.
            invoice_item_id: items[lineIndex].id,
          }),
        ),
      );
    }

    const payload: InvoiceCreatedPayloadShape = {
      invoiceId: invoice.id,
      memberId: invoice.member_id,
      invoiceNumber: invoice.invoice_number,
      issueDate: invoice.invoice_date.toISOString(),
      dueDate: invoice.due_date.toISOString(),
      totalAmount: invoice.total_amount,
      lineItems: items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        ...(item.tax_code ? { taxCode: item.tax_code } : {}),
      })),
    };

    await this.outboxService.saveEventEnvelope(
      FINANCE_EVENT_TYPES.INVOICE_CREATED, // docs/event-contracts.md §InvoiceCreated.v1
      FINANCE_EVENT_VERSION,               // EVENT_VERSIONS.V1
      input.organizationId,                // authorized org (server-derived, never from a DTO)
      payload,
      invoice.id,                          // correlationId = invoice id (existing convention)
      input.causationId,                   // the membership sale that caused it, if any
      manager,                             // transaction-scoped: commits/rolls back with the invoice
    );

    return { invoice, items, taxLines: savedTaxLines };
  }
}

