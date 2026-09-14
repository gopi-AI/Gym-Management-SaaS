import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { QueryPaymentDto } from '../dto/query-payment.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { InvoicesService } from './invoices.service';
import { PaymentAttemptOutcome } from './payment-gateway.port';
import {
  FINANCE_EVENT_TYPES,
  FINANCE_EVENT_VERSION,
  INVOICE_STATUS,
  INVOICE_STATUS_MESSAGES,
  PAYABLE_INVOICE_STATUSES,
  PAYMENT_STATUS,
  VALID_INVOICE_TRANSITIONS,
  paymentRetryDelayMs,
  toMoney,
} from '../finance.constants';

/**
 * Structural mirrors of the finance event payloads in
 * packages/contracts/src/events/finance.events.ts (which mirror
 * `docs/event-contracts.md` §Finance Events).
 */
interface PaymentSucceededPayloadShape extends Record<string, unknown> {
  paymentId: string;
  invoiceId: string;
  amount: string;
  paymentMethod: string;
  transactionId?: string;
  paymentDate: string;
}

interface PaymentFailedPayloadShape extends Record<string, unknown> {
  paymentId: string;
  invoiceId: string;
  amount: string;
  failureReason: string;
  failureCode: string;
  paymentDate: string;
}

/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
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

  private static isUniqueViolation(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      driverError?: { code?: string };
      message?: string;
    };
    const code = candidate?.driverError?.code ?? candidate?.code;
    return code === UNIQUE_VIOLATION_CODE;
  }

  /**
   * Record a successful payment against an invoice
   * (`POST /v1/invoices/{id}/payments`).
   *
   * Everything happens in ONE transaction on a row-locked invoice:
   *   1. idempotency replay check (a repeated key returns the first payment);
   *   2. invoice state check (only issued/partially paid invoices are payable);
   *   3. over-payment rejection against the *derived* outstanding balance;
   *   4. payment insert;
   *   5. invoice status transition (partially_paid / paid);
   *   6. `PaymentSucceeded.v1` enqueue on the same transaction.
   *
   * The client never supplies a status: a manual front-desk recording is money
   * that has already changed hands, so it is written directly as `succeeded`.
   */
  async recordForInvoice(invoiceId: string, dto: CreatePaymentDto): Promise<Payment> {
    const organizationId = await this.resolveAuthorizedOrg();
    const amount = toMoney(dto.amount);
    const idempotencyKey = dto.idempotency_key?.trim() || `manual:${invoiceId}:${randomUUID()}`;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const paymentRepository = manager.getRepository(Payment);

        // Idempotent replay: the same key must never charge twice.
        const existing = await paymentRepository.findOne({
          where: { idempotency_key: idempotencyKey, organization_id: organizationId },
        });
        if (existing) return existing;

        // Row lock: concurrent recordings on the same invoice serialize, so the
        // second one sees the first one's payment and cannot over-pay.
        const invoice = await this.invoicesService.loadInvoiceForUpdate(
          manager,
          invoiceId,
          organizationId,
        );

        if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
          throw new BadRequestException(
            INVOICE_STATUS_MESSAGES[invoice.status] ??
              `Invoice is '${invoice.status}' and cannot accept a payment`,
          );
        }

        const totals = await this.invoicesService.paymentTotalsByInvoice(
          organizationId,
          [invoice.id],
          manager,
        );
        const alreadyPaid = totals.get(invoice.id) ?? '0.00';
        const outstanding = toMoney(Number(invoice.total_amount) - Number(alreadyPaid));

        if (Number(outstanding) <= 0) {
          throw new BadRequestException('Invoice has no outstanding balance');
        }
        if (Number(amount) > Number(outstanding)) {
          // Over-payments (and the credit/refund handling they imply) are out of
          // scope for this pass, so they are rejected rather than absorbed.
          throw new BadRequestException(
            `Payment amount ${amount} exceeds the outstanding balance ${outstanding}`,
          );
        }

        const paymentDate = dto.payment_date ? new Date(dto.payment_date) : new Date();

        const payment = await paymentRepository.save(
          paymentRepository.create({
            organization_id: organizationId,
            branch_id: invoice.branch_id ?? null,
            member_id: invoice.member_id,
            invoice_id: invoice.id,
            payment_method: dto.payment_method,
            transaction_id: dto.transaction_id ?? null,
            amount,
            payment_date: paymentDate,
            status: PAYMENT_STATUS.SUCCEEDED,
            idempotency_key: idempotencyKey,
            retry_count: 0,
            last_attempt_at: paymentDate,
            next_retry_at: null,
            last_failure_reason: null,
          }),
        );

        await this.applySuccessfulPaymentToInvoice(manager, invoice, organizationId);

        const payload: PaymentSucceededPayloadShape = {
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: payment.amount,
          paymentMethod: payment.payment_method,
          paymentDate: payment.payment_date.toISOString(),
          ...(payment.transaction_id ? { transactionId: payment.transaction_id } : {}),
        };

        await this.outboxService.saveEventEnvelope(
          FINANCE_EVENT_TYPES.PAYMENT_SUCCEEDED, // docs/event-contracts.md §PaymentSucceeded.v1
          FINANCE_EVENT_VERSION,                 // EVENT_VERSIONS.V1
          organizationId,                        // authorized org (server-derived, never from a DTO)
          payload,
          invoice.id,                            // correlationId = invoice id (money trail of that invoice)
          undefined,                             // causationId: not used for this event
          manager,                               // transaction-scoped: atomic with the payment row
        );

        return payment;
      });
    } catch (error) {
      // Two concurrent requests with the same key: the unique index decides the
      // winner and the loser returns the winner's payment instead of a 500.
      if (dto.idempotency_key && PaymentsService.isUniqueViolation(error)) {
        const existing = await this.paymentRepository.findOne({
          where: { idempotency_key: idempotencyKey, organization_id: organizationId },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * Move an invoice to its post-payment state.
   *
   * The balance is RECOMPUTED from succeeded payments after the insert (never
   * from a counter), so the invoice status always reflects the payments table —
   * including when several payments land one after another.
   */
  private async applySuccessfulPaymentToInvoice(
    manager: EntityManager,
    invoice: Invoice,
    organizationId: string,
  ): Promise<Invoice> {
    const totals = await this.invoicesService.paymentTotalsByInvoice(
      organizationId,
      [invoice.id],
      manager,
    );
    const amountPaid = totals.get(invoice.id) ?? '0.00';
    const fullyPaid = Number(amountPaid) >= Number(invoice.total_amount);
    const nextStatus = fullyPaid ? INVOICE_STATUS.PAID : INVOICE_STATUS.PARTIALLY_PAID;

    const allowed = VALID_INVOICE_TRANSITIONS[invoice.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid invoice transition from '${invoice.status}' to '${nextStatus}'`,
      );
    }

    const paidAt = fullyPaid ? invoice.paid_at ?? new Date() : null;
    await manager
      .getRepository(Invoice)
      .update({ id: invoice.id, organization_id: organizationId }, { status: nextStatus, paid_at: paidAt });

    return { ...invoice, status: nextStatus, paid_at: paidAt };
  }

  /** Paginated payment list (tenant-scoped, newest first). */
  async findAll(query: QueryPaymentDto): Promise<{
    data: Payment[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const where: Record<string, unknown> = { organization_id: organizationId };
    if (query.invoice_id) where.invoice_id = query.invoice_id;
    if (query.member_id) where.member_id = query.member_id;
    if (query.branch_id) where.branch_id = query.branch_id;
    if (query.status) where.status = query.status;

    const [data, total] = await this.paymentRepository.findAndCount({
      where: where as never,
      order: { payment_date: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return { data, total, page, limit };
  }

  /** Single payment, scoped to the authorized organization. */
  async findOne(id: string): Promise<Payment> {
    const organizationId = await this.resolveAuthorizedOrg();
    const payment = await this.paymentRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /**
   * WORKER-ONLY: pending payments whose retry is due, across ALL organizations.
   *
   * Background workers hold no request/tenant context (there is no authenticated
   * user), so this lookup is intentionally not tenant-scoped; every write that
   * follows is scoped by the payment row's own `organization_id`.
   */
  async findDueRetries(now: Date, limit: number): Promise<Payment[]> {
    return this.paymentRepository
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: PAYMENT_STATUS.PENDING })
      .andWhere('(payment.next_retry_at IS NULL OR payment.next_retry_at <= :now)', { now })
      .orderBy('payment.next_retry_at', 'ASC', 'NULLS FIRST')
      .addOrderBy('payment.created_at', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * WORKER-ONLY: apply the outcome of one gateway retry attempt.
   *
   * Re-reads the payment under a row lock and re-checks that it is still
   * `pending`, so a payment already resolved by a concurrent worker (or by a
   * manual recording) is never processed twice. All retry bookkeeping
   * (`retry_count`, `last_attempt_at`, `next_retry_at`, `last_failure_reason`) is
   * persisted on the row itself, so the retry schedule survives a restart.
   */
  async applyRetryOutcome(
    paymentId: string,
    outcome: PaymentAttemptOutcome,
    options: { maxAttempts: number; now?: Date },
  ): Promise<{ status: string; retryCount: number; exhausted: boolean }> {
    const now = options.now ?? new Date();

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Payment);
      const payment = await repository.findOne({
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('Payment not found');

      if (payment.status !== PAYMENT_STATUS.PENDING) {
        return { status: payment.status, retryCount: payment.retry_count, exhausted: false };
      }

      const retryCount = payment.retry_count + 1;
      const organizationId = payment.organization_id; // owns the payment: the only valid scope here
      payment.retry_count = retryCount;
      payment.last_attempt_at = now;

      if (outcome.succeeded) {
        payment.status = PAYMENT_STATUS.SUCCEEDED;
        payment.next_retry_at = null;
        payment.last_failure_reason = null;
        if (outcome.transactionId) payment.transaction_id = outcome.transactionId;
        await repository.save(payment);

        const invoice = await manager.getRepository(Invoice).findOne({
          where: { id: payment.invoice_id, organization_id: organizationId },
        });
        // A voided/paid invoice cannot be re-transitioned; the money is still
        // recorded as succeeded and flagged for manual reconciliation instead of
        // failing (and endlessly retrying) the charge.
        if (invoice && PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
          await this.applySuccessfulPaymentToInvoice(manager, invoice, organizationId);
        }

        const payload: PaymentSucceededPayloadShape = {
          paymentId: payment.id,
          invoiceId: payment.invoice_id,
          amount: payment.amount,
          paymentMethod: payment.payment_method,
          paymentDate: now.toISOString(),
          ...(payment.transaction_id ? { transactionId: payment.transaction_id } : {}),
        };
        await this.outboxService.saveEventEnvelope(
          FINANCE_EVENT_TYPES.PAYMENT_SUCCEEDED, // docs/event-contracts.md §PaymentSucceeded.v1
          FINANCE_EVENT_VERSION,
          organizationId,
          payload,
          payment.invoice_id, // correlationId = invoice id (money trail of that invoice)
          undefined,
          manager,
        );

        return { status: payment.status, retryCount, exhausted: false };
      }

      const exhausted = retryCount >= options.maxAttempts;
      const failureReason = outcome.failureReason ?? 'Payment attempt failed';
      payment.status = exhausted ? PAYMENT_STATUS.FAILED : PAYMENT_STATUS.PENDING;
      payment.last_failure_reason = failureReason;
      payment.next_retry_at = exhausted
        ? null
        : new Date(now.getTime() + paymentRetryDelayMs(retryCount));
      await repository.save(payment);

      if (exhausted) {
        const payload: PaymentFailedPayloadShape = {
          paymentId: payment.id,
          invoiceId: payment.invoice_id,
          amount: payment.amount,
          failureReason,
          failureCode: outcome.failureCode ?? 'UNKNOWN',
          paymentDate: now.toISOString(),
        };
        await this.outboxService.saveEventEnvelope(
          FINANCE_EVENT_TYPES.PAYMENT_FAILED, // docs/event-contracts.md §PaymentFailed.v1
          FINANCE_EVENT_VERSION,
          organizationId,
          payload,
          payment.invoice_id,
          undefined,
          manager,
        );
      }

      return { status: payment.status, retryCount, exhausted };
    });
  }
}
