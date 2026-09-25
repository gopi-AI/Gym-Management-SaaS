import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Refund } from '../entities/refund.entity';
import { Payment } from '../entities/payment.entity';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { QueryRefundDto } from '../dto/query-refund.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  FINANCE_EVENT_TYPES,
  FINANCE_EVENT_VERSION,
  PAYMENT_STATUS,
  REFUND_STATUS,
  toMoney,
} from '../finance.constants';

/**
 * Structural mirror of `RefundIssuedPayload` in
 * `packages/contracts/src/events/finance.events.ts`.
 */
interface RefundIssuedPayloadShape extends Record<string, unknown> {
  refundId: string;
  paymentId: string;
  invoiceId: string;
  amount: string;
  reason: string;
  refundDate: string;
  status: string;
}

/**
 * P3-02 — refunds against payments (`docs/phase3-scoping-plan.md` §2).
 *
 * A refund attaches to a PAYMENT, not an invoice (§2's table). That is what makes
 * the invariant expressible: `SUM(refunds.amount) <= payment.amount`.
 *
 * ## The invariant, and why it is enforced inside the transaction
 *
 * `create()` locks the payment row (`pessimistic_write`) and recomputes the
 * already-refunded total from the refunds table **inside** that transaction. A
 * read-then-write pre-check outside a transaction would let two concurrent refunds
 * each observe the same un-refunded balance and both pass, over-refunding the
 * payment. Holding the row lock serializes them, so the second one sees the
 * first one's refund.
 *
 * ## Why refunds are manual in P3-02 (§15 Q5 ruling)
 *
 * This service does **not** inject `PAYMENT_GATEWAY`. P3-02 refunds are entirely
 * staff-initiated and recorded directly as `succeeded`, because no provider
 * integration exists yet — so there is nothing to call, and injecting a seam that
 * is never used would imply a capability the task does not have. P3-03 adds a
 * gateway-initiated path through the same columns (`pending` already exists in
 * both the value set and the schema) as an addition, not a redesign.
 *
 * ## Known gap: no idempotency key
 *
 * A refund carries no idempotency key, unlike `Payment`. The invariant above is
 * therefore the ONLY protection: a duplicate submission that still fits under the
 * payment's remaining balance is recorded as two legitimate refunds, because
 * nothing distinguishes it from a member genuinely being refunded twice. Accepted
 * for P3-02, where each refund is a deliberate act by a person at a desk, and
 * tracked in `docs/phase3-scoping-plan.md` §3's dependency list as work **P3-03**
 * must close — automated retries make a duplicate indistinguishable from a retry.
 */
@Injectable()
export class RefundsService {
  constructor(
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

  private static isUniqueViolation(error: unknown): boolean {
    const candidate = error as { code?: string; driverError?: { code?: string } };
    return (candidate?.driverError?.code ?? candidate?.code) === '23505';
  }

  /** Authorized organization, mirroring PaymentsService.resolveAuthorizedOrg. */
  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) return currentOrgId;
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) throw new ForbiddenException('Organization context required');
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /**
   * Total already refunded against a payment, counting only refunds that moved
   * money. A `failed` refund returned nothing, so it must not reduce the
   * refundable balance.
   */
  private static async refundedTotal(
    manager: EntityManager,
    organizationId: string,
    paymentId: string,
  ): Promise<string> {
    const row: { refunded: string } | undefined = await manager
      .getRepository(Refund)
      .createQueryBuilder('refund')
      .select('COALESCE(SUM(refund.amount), 0)', 'refunded')
      .where('refund.organization_id = :organizationId', { organizationId })
      .andWhere('refund.payment_id = :paymentId', { paymentId })
      .andWhere('refund.status = :status', { status: REFUND_STATUS.SUCCEEDED })
      .getRawOne();
    return toMoney(row?.refunded ?? 0);
  }

  /**
   * Issue a refund against a payment (`POST /v1/payments/{id}/refunds`).
   *
   * One transaction on a row-locked payment:
   *   1. load the payment scoped to the authorized org, `FOR UPDATE`;
   *   2. only a `succeeded` payment is refundable — refunding a `pending` or
   *      `failed` payment would return money that never arrived;
   *   3. recompute the already-refunded total from the refunds table;
   *   4. reject anything exceeding the un-refunded balance;
   *   5. insert the refund as `succeeded`;
   *   6. enqueue `RefundIssued.v1` on the same transaction.
   *
   * The client never supplies a status: a manually recorded refund is money that
   * has already changed hands, so it is written directly as `succeeded`.
   */
  async create(paymentId: string, dto: CreateRefundDto): Promise<Refund> {
    const organizationId = await this.resolveAuthorizedOrg();
    const amount = toMoney(dto.amount);
    const idempotencyKey = dto.idempotency_key?.trim() || `refund:${paymentId}:${randomUUID()}`;

    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.getRepository(Payment).findOne({
        where: { id: paymentId, organization_id: organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      const existing = await manager.getRepository(Refund).findOne({ where: { organization_id: organizationId, idempotency_key: idempotencyKey } });
      if (existing) return existing;

      if (payment.status !== PAYMENT_STATUS.SUCCEEDED) {
        throw new BadRequestException(
          `Only a succeeded payment can be refunded; this payment is '${payment.status}'`,
        );
      }

      const alreadyRefunded = await RefundsService.refundedTotal(
        manager,
        organizationId,
        paymentId,
      );
      const refundable = toMoney(Number(payment.amount) - Number(alreadyRefunded));

      // Checked against the payment's un-refunded balance, so partial refunds are
      // allowed repeatedly (§15 Q5) with no separate cap: the payment is the cap.
      if (Number(refundable) <= 0) {
        throw new BadRequestException('Payment has already been fully refunded');
      }
      if (Number(amount) > Number(refundable)) {
        throw new BadRequestException(
          `Refund amount ${amount} exceeds the un-refunded balance ${refundable}`,
        );
      }

      const refundDate = dto.refund_date ? new Date(dto.refund_date) : new Date();
      const repository = manager.getRepository(Refund);

      let refund: Refund;
      try {
        refund = await repository.save(
          repository.create({
          organization_id: organizationId,
          payment_id: payment.id,
          reason: dto.reason,
          amount,
          refund_date: refundDate,
          status: REFUND_STATUS.SUCCEEDED,
            idempotency_key: idempotencyKey,
          }),
        );
      } catch (error) {
        if (!RefundsService.isUniqueViolation(error)) throw error;
        const replay = await repository.findOne({ where: { organization_id: organizationId, idempotency_key: idempotencyKey } });
        if (replay) return replay;
        throw error;
      }

      const payload: RefundIssuedPayloadShape = {
        refundId: refund.id,
        paymentId: payment.id,
        // Denormalised into the event from the payment: a refund has no invoice
        // column of its own, but every consumer of this event wants the invoice.
        invoiceId: payment.invoice_id,
        amount: refund.amount,
        reason: refund.reason,
        refundDate: refund.refund_date.toISOString(),
        status: refund.status,
      };

      await this.outboxService.saveEventEnvelope(
        FINANCE_EVENT_TYPES.REFUND_ISSUED, // docs/event-contracts.md §RefundIssued.v1
        FINANCE_EVENT_VERSION,
        organizationId,
        payload,
        payment.invoice_id, // correlationId = invoice id (money trail of that invoice)
        undefined,
        manager, // transaction-scoped: atomic with the refund row
      );

      return refund;
    });
  }

  /**
   * Apply a gateway refund confirmation inside the caller's transaction.
   * The refund row is locked here so duplicate deliveries and races with a
   * synchronous refund path can only produce one transition and one event.
   */
  async applyGatewayOutcome(
    manager: EntityManager,
    refundId: string,
    outcome: { succeeded: boolean; gatewayStatus?: string },
  ): Promise<Refund | null> {
    const refund = await manager.getRepository(Refund).findOne({
      where: { id: refundId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!refund || !outcome.succeeded || refund.status !== REFUND_STATUS.PENDING) return refund;

    refund.status = REFUND_STATUS.SUCCEEDED;
    const saved = await manager.getRepository(Refund).save(refund);
    const payment = await manager.getRepository(Payment).findOne({
      where: { id: refund.payment_id, organization_id: refund.organization_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    await this.outboxService.saveEventEnvelope(
      FINANCE_EVENT_TYPES.REFUND_ISSUED,
      FINANCE_EVENT_VERSION,
      refund.organization_id,
      {
        refundId: refund.id,
        paymentId: payment.id,
        invoiceId: payment.invoice_id,
        amount: refund.amount,
        reason: refund.reason,
        refundDate: refund.refund_date.toISOString(),
        status: refund.status,
      } satisfies RefundIssuedPayloadShape,
      payment.invoice_id,
      undefined,
      manager,
    );
    return saved;
  }

  /** Paginated, tenant-scoped refund list (newest first). */
  async findAll(query: QueryRefundDto): Promise<{
    data: Refund[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const where: Record<string, unknown> = { organization_id: organizationId };
    if (query.payment_id) where.payment_id = query.payment_id;
    if (query.status) where.status = query.status;

    const [data, total] = await this.refundRepository.findAndCount({
      where,
      order: { refund_date: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Refund> {
    const organizationId = await this.resolveAuthorizedOrg();
    const refund = await this.refundRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }
}
