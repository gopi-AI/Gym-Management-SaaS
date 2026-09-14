import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Payment } from '../entities/payment.entity';
import { CreateInvoiceDto, InvoiceLineItemDto } from '../dto/create-invoice.dto';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { endOfRange } from '../../shared/utils/date-range';
import { InvoiceNumberService } from './invoice-number.service';
import {
  FINANCE_EVENT_VERSION,
  FINANCE_EVENT_TYPES,
  INVOICE_STATUS,
  OUTSTANDING_INVOICE_STATUSES,
  PAYMENT_STATUS,
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
  dueDate?: Date;
  /** Caller's transaction: the invoice must commit with the membership. */
  manager: EntityManager;
}

/** An invoice together with its lines and its derived payment balance. */
export interface InvoiceWithDetail {
  invoice: Invoice;
  items: InvoiceItem[];
  amount_paid: string;
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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
    private readonly invoiceNumberService: InvoiceNumberService,
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

  private static outstanding(total: string, paid: string): string {
    return toMoney(Math.max(0, Number(total) - Number(paid)));
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

    const data: InvoiceListItem[] = rows.map((invoice) => {
      const paid = totals.get(invoice.id) ?? '0.00';
      return {
        ...invoice,
        amount_paid: paid,
        outstanding_amount: InvoicesService.outstanding(invoice.total_amount, paid),
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

    return {
      invoice,
      items,
      amount_paid: amountPaid,
      outstanding_amount: InvoicesService.outstanding(invoice.total_amount, amountPaid),
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

    return {
      ...detail,
      amount_paid: amountPaid,
      outstanding_amount: InvoicesService.outstanding(detail.invoice.total_amount, amountPaid),
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
  ): Promise<{ invoice: Invoice; items: InvoiceItem[] }> {
    return this.persistInvoice(input.manager, {
      organizationId: input.organizationId,
      memberId: input.memberId,
      membershipId: input.membershipId,
      branchId: input.branchId,
      lineItems: [
        {
          description: input.description,
          quantity: 1,
          unit_price: Number(input.amount),
        },
      ],
      status: INVOICE_STATUS.SENT,
      // A counter sale is due on receipt, not on 14-day terms.
      dueDate: input.dueDate ?? new Date(),
      causationId: input.membershipId,
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
   * TODO(phase-2): emit an invoice-voided event and support voiding partially
   * paid invoices once RefundIssued exists in `docs/event-contracts.md`. No event
   * is invented here because the contract defines none for this transition.
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
          'A paid invoice cannot be voided; issue a refund/credit note instead (out of scope)',
        );
      }

      const totals = await this.paymentTotalsByInvoice(organizationId, [invoice.id], manager);
      const amountPaid = totals.get(invoice.id) ?? '0.00';
      if (Number(amountPaid) > 0) {
        throw new BadRequestException(
          `Invoice already has ${amountPaid} collected against it; refunds are out of scope, so it cannot be voided`,
        );
      }

      await manager
        .getRepository(Invoice)
        .update({ id: invoice.id, organization_id: organizationId }, { status: INVOICE_STATUS.VOID });

      return { ...invoice, status: INVOICE_STATUS.VOID };
    });
  }

  /** Subtotal, tax and total for a set of lines. Tax is out of scope (always 0.00). */
  private static computeTotals(items: InvoiceLineItemDto[]): {
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
  } {
    const subtotal = sumMoney(items.map((item) => Number(item.quantity) * Number(item.unit_price)));
    // TODO(phase-2): compute tax per tax_code. Until then tax_amount is 0.00, so
    // the total stays arithmetically consistent with subtotal + tax_amount.
    const taxAmount = toMoney(0);
    return { subtotal, taxAmount, totalAmount: sumMoney([subtotal, taxAmount]) };
  }

  /** Default payment terms: due DEFAULT_PAYMENT_TERM_DAYS after issue. */
  private static defaultDueDate(from: Date = new Date()): Date {
    const due = new Date(from.getTime());
    due.setDate(due.getDate() + DEFAULT_PAYMENT_TERM_DAYS);
    return due;
  }

  /**
   * Write an invoice + its line items + its `InvoiceCreated` event on the
   * caller's transaction. Shared by the explicit and the sale-driven creation
   * paths so the two can never diverge.
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
    },
  ): Promise<{ invoice: Invoice; items: InvoiceItem[] }> {
    const { subtotal, taxAmount, totalAmount } = InvoicesService.computeTotals(input.lineItems);

    // Allocated on the caller's connection, under a row lock on the counter
    // (see InvoiceNumberService), so concurrent sales cannot share a number.
    const invoiceNumber = await this.invoiceNumberService.nextInvoiceNumber(
      input.organizationId,
      manager,
    );
    const invoiceDate = new Date();

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

    return { invoice, items };
  }
}

