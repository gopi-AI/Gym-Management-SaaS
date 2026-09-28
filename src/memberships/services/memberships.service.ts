import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual, MoreThan, IsNull, Or } from 'typeorm';
import { Membership } from '../entities/membership.entity';
import { MembershipHistory } from '../entities/membership-history.entity';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { MembershipDiscount } from '../entities/membership-discount.entity';
import { CreateMembershipDiscountDto } from '../dto/create-membership-discount.dto';
import { CreateMembershipDto } from '../dto/create-membership.dto';
import { UpdateMembershipDto } from '../dto/update-membership.dto';
import { QueryMembershipDto } from '../dto/query-membership.dto';
import { MembershipLifecycleDto } from '../dto/membership-lifecycle.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { InvoicesService } from '../../finance/services/invoices.service';
import { PaymentsService } from '../../finance/services/payments.service';
import { Payment } from '../../finance/entities/payment.entity';
import { Invoice } from '../../finance/entities/invoice.entity';
import { InvoiceItem } from '../../finance/entities/invoice-item.entity';
import { PAYMENT_STATUS } from '../../finance/finance.constants';

/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

const MEMBERSHIP_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  FROZEN: 'frozen',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;

type MembershipStatus = (typeof MEMBERSHIP_STATUS)[keyof typeof MEMBERSHIP_STATUS];

const VALID_TRANSITIONS: Record<string, string[]> = {
  [MEMBERSHIP_STATUS.ACTIVE]: [MEMBERSHIP_STATUS.PAUSED, MEMBERSHIP_STATUS.FROZEN, MEMBERSHIP_STATUS.CANCELLED, MEMBERSHIP_STATUS.EXPIRED],
  [MEMBERSHIP_STATUS.PAUSED]: [MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.CANCELLED, MEMBERSHIP_STATUS.EXPIRED],
  [MEMBERSHIP_STATUS.FROZEN]: [MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.CANCELLED, MEMBERSHIP_STATUS.EXPIRED],
  [MEMBERSHIP_STATUS.CANCELLED]: [],
  [MEMBERSHIP_STATUS.EXPIRED]: [],
};

const TRANSITION_NAMES: Record<string, string> = {
  [`${MEMBERSHIP_STATUS.ACTIVE}->${MEMBERSHIP_STATUS.PAUSED}`]: 'pause',
  [`${MEMBERSHIP_STATUS.PAUSED}->${MEMBERSHIP_STATUS.ACTIVE}`]: 'resume',
  [`${MEMBERSHIP_STATUS.ACTIVE}->${MEMBERSHIP_STATUS.FROZEN}`]: 'freeze',
  [`${MEMBERSHIP_STATUS.FROZEN}->${MEMBERSHIP_STATUS.ACTIVE}`]: 'unfreeze',
  [`${MEMBERSHIP_STATUS.ACTIVE}->${MEMBERSHIP_STATUS.CANCELLED}`]: 'cancel',
  [`${MEMBERSHIP_STATUS.PAUSED}->${MEMBERSHIP_STATUS.CANCELLED}`]: 'cancel',
  [`${MEMBERSHIP_STATUS.FROZEN}->${MEMBERSHIP_STATUS.CANCELLED}`]: 'cancel',
  [`${MEMBERSHIP_STATUS.ACTIVE}->${MEMBERSHIP_STATUS.EXPIRED}`]: 'expire',
  [`${MEMBERSHIP_STATUS.PAUSED}->${MEMBERSHIP_STATUS.EXPIRED}`]: 'expire',
  [`${MEMBERSHIP_STATUS.FROZEN}->${MEMBERSHIP_STATUS.EXPIRED}`]: 'expire',
};

/**
 * Membership statuses that BLOCK a front-desk check-in, mapped to the reason
 * returned to the caller. Derived from `VALID_TRANSITIONS`/`MEMBERSHIP_STATUS`
 * above so the two can never drift.
 */
const CHECK_IN_BLOCKED_REASONS: Record<string, string> = {
  [MEMBERSHIP_STATUS.PAUSED]: 'paused',
  [MEMBERSHIP_STATUS.FROZEN]: 'frozen',
  [MEMBERSHIP_STATUS.CANCELLED]: 'cancelled',
  [MEMBERSHIP_STATUS.EXPIRED]: 'expired',
};

/** Statuses that are still "in force" and therefore candidates for expiry. */
const NON_TERMINAL_STATUSES: MembershipStatus[] = [
  MEMBERSHIP_STATUS.ACTIVE,
  MEMBERSHIP_STATUS.PAUSED,
  MEMBERSHIP_STATUS.FROZEN,
];

/** Result of validating a member's eligibility at check-in time. */
export type CheckInEligibility =
  | { eligible: true; membership: Membership }
  | { eligible: false; reason: string };

/** A membership is eligible only while `active` AND inside its date window. */
export function isMembershipEligibleAt(
  membership: Pick<Membership, 'status' | 'start_date' | 'end_date'>,
  at: Date = new Date(),
): boolean {
  if (membership.status !== MEMBERSHIP_STATUS.ACTIVE) return false;
  const day = at.toISOString().split('T')[0];
  if (membership.start_date && membership.start_date > day) return false;
  // A null end_date means the membership is open-ended.
  if (membership.end_date && membership.end_date < day) return false;
  return true;
}

/**
 * Evaluate a member's membership set for check-in eligibility.
 *
 * Eligible when ANY membership is active and inside its window (a member may
 * hold an old expired record plus a current one). When none qualifies, the
 * reason is derived from the most recent membership so the front desk gets an
 * actionable message ("membership paused", "membership expired", …).
 */
export function evaluateCheckInEligibility(
  memberships: Pick<Membership, 'status' | 'start_date' | 'end_date'>[],
  at: Date = new Date(),
): CheckInEligibility {
  if (memberships.length === 0) {
    return { eligible: false, reason: 'no_membership' };
  }
  const eligible = memberships.find((m) => isMembershipEligibleAt(m, at));
  if (eligible) {
    return { eligible: true, membership: eligible as Membership };
  }
  const latest = memberships[0];
  const blocked = CHECK_IN_BLOCKED_REASONS[latest.status];
  if (blocked) return { eligible: false, reason: blocked };
  const day = at.toISOString().split('T')[0];
  if (latest.start_date && latest.start_date > day) {
    return { eligible: false, reason: 'not_started' };
  }
  return { eligible: false, reason: 'ended' };
}

/**
 * Whole calendar days between two Date instants (floored).
 * Returns 0 when `to` is before `from` or when the diff is under one day.
 */
function diffDays(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / msPerDay));
}

/**
 * Add `days` whole calendar days to a `YYYY-MM-DD` date string.
 * Returns the result in the same `YYYY-MM-DD` form.
 */
function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Current event version for membership events. Mirrors EVENT_VERSIONS.V1 in
 * packages/contracts/src/events/membership.events.ts (lines 99-101).
 */
const MEMBERSHIP_EVENT_VERSION = 'v1';

/**
 * Structural mirror of MembershipStartedPayload in
 * packages/contracts/src/events/membership.events.ts (lines 9-15).
 */
interface MembershipStartedPayloadShape extends Record<string, unknown> {
  membershipId: string;
  memberId: string;
  planId: string;
  startDate: string;
  initialFee: string;
}

/**
 * Structural mirror of MembershipExpiredPayload in
 * packages/contracts/src/events/membership.events.ts.
 */
interface MembershipExpiredPayloadShape extends Record<string, unknown> {
  membershipId: string;
  memberId: string;
  expiredAt: string;
  endDate?: string;
}

/**
 * Structural mirror of MembershipRenewedPayload in
 * packages/contracts/src/events/membership.events.ts (lines 17-22), documented as
 * `MembershipRenewed.v1` in docs/event-contracts.md (line 44). Both the interface
 * and the doc entry pre-date Phase 3, so emitting this event creates no net-new
 * contract.
 */
interface MembershipRenewedPayloadShape extends Record<string, unknown> {
  membershipId: string;
  renewalDate: string;
  nextPaymentDate: string;
  renewalFee: string;
}

@Injectable()
export class MembershipsService {
  constructor(
    @InjectRepository(Membership)
    private readonly membershipRepository: Repository<Membership>,
    @InjectRepository(MembershipPlan)
    private readonly planRepository: Repository<MembershipPlan>,
    @InjectRepository(MembershipHistory)
    private readonly historyRepository: Repository<MembershipHistory>,
    @InjectRepository(MembershipDiscount)
    private readonly discountRepository: Repository<MembershipDiscount>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
    private readonly invoicesService: InvoicesService,
    // REQUIRED, deliberately not @Optional(): an optional injection would turn a
    // future DI regression into a silent financial failure — `renewOne` would
    // skip the gateway charge and leave the renewal payment `pending` forever
    // with no error anywhere. FinanceModule exports this provider, and the
    // AppModule boot specs (app.module.spec.ts, app.boot.spec.ts) fail loudly if
    // the wiring ever breaks.
    private readonly paymentsService: PaymentsService,
  ) {}

  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) return currentOrgId;
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) throw new ForbiddenException('Organization context required');
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  private async ensureResourceBelongsToOrg(
    repository: Repository<any>,
    id: string,
    organizationId: string,
    entityName: string,
    activeCheck?: boolean,
  ): Promise<any> {
    const where: any = { id, organization_id: organizationId };
    if (activeCheck) where.is_active = true;
    const resource = await repository.findOne({ where } as any);
    if (!resource) throw new BadRequestException(`${entityName} not found or not in the authorized organization`);
    return resource;
  }

  private async ensureMemberBelongsToOrg(memberId: string, organizationId: string): Promise<void> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('1')
      .from('MEMBERS_MEMBERS', 'm')
      .where('m.id = :id AND m.organization_id = :orgId AND m.is_active = :active', {
        id: memberId, orgId: organizationId, active: true,
      })
      .getRawOne();
    if (!result) throw new BadRequestException('Member not found or does not belong to the authorized organization');
  }

  async findAll(query: QueryMembershipDto): Promise<{ data: Membership[]; total: number; page: number; limit: number }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { organization_id: organizationId };
    if (query.status) where.status = query.status;
    if (query.member_id) where.member_id = query.member_id;
    if (query.plan_id) where.plan_id = query.plan_id;
    if (query.branch_id) where.branch_id = query.branch_id;
    const [data, total] = await this.membershipRepository.findAndCount({
      where, order: { created_at: 'DESC' }, take: limit, skip,
    });
    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Membership> {
    const organizationId = await this.resolveAuthorizedOrg();
    const membership = await this.membershipRepository.findOne({
      where: { id, organization_id: organizationId } as any,
    });
    if (!membership) throw new NotFoundException('Membership not found');
    return membership;
  }

  async findByMember(memberId: string, query: QueryMembershipDto): Promise<{ data: Membership[]; total: number; page: number; limit: number }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { organization_id: organizationId, member_id: memberId };
    if (query.status) where.status = query.status;
    const [data, total] = await this.membershipRepository.findAndCount({
      where, order: { created_at: 'DESC' }, take: limit, skip,
    });
    return { data, total, page, limit };
  }

  /**
   * Resolve a member's check-in eligibility.
   *
   * Reuses the membership status model owned by this module (see
   * `evaluateCheckInEligibility`) instead of duplicating the rules in the
   * attendance module. The caller passes the AUTHORIZED organization id obtained
   * from `TenantContextService`; this method never widens the tenant scope.
   */
  async getCheckInEligibility(
    memberId: string,
    organizationId: string,
    at: Date = new Date(),
  ): Promise<CheckInEligibility> {
    const memberships = await this.membershipRepository.find({
      where: { member_id: memberId, organization_id: organizationId } as any,
      order: { created_at: 'DESC' },
      take: 20,
    });
    return evaluateCheckInEligibility(memberships, at);
  }

  /**
   * Transition every membership that has passed its end date to `expired`.
   *
   * WORKER-ONLY: background workers hold no request/tenant context (there is no
   * authenticated user), so this method intentionally scans across
   * organizations and must never be reachable from an HTTP controller. Each
   * candidate is re-validated under a row lock inside its own transaction, and
   * every write is scoped by the candidate row's own `organization_id`, so
   * concurrent workers cannot double-transition or double-publish.
   */
  async expireDueMemberships(
    options: { limit?: number; today?: string } = {},
  ): Promise<{ scanned: number; expired: number; membershipIds: string[] }> {
    const limit = options.limit ?? 200;
    const today = options.today ?? new Date().toISOString().split('T')[0];

    const candidates = await this.membershipRepository
      .createQueryBuilder('membership')
      .where('membership.status IN (:...statuses)', { statuses: NON_TERMINAL_STATUSES })
      .andWhere('membership.end_date IS NOT NULL')
      .andWhere('membership.end_date < :today', { today })
      .orderBy('membership.end_date', 'ASC')
      .limit(limit)
      .getMany();

    const membershipIds: string[] = [];
    for (const candidate of candidates) {
      const didExpire = await this.expireOne(
        candidate.id,
        candidate.organization_id,
        today,
      );
      if (didExpire) membershipIds.push(candidate.id);
    }

    return {
      scanned: candidates.length,
      expired: membershipIds.length,
      membershipIds,
    };
  }

  /**
   * Renew one membership at its renewal date. Request calls are tenant-scoped;
   * the worker calls the internal organization-pinned path below. Invoice and
   * pending payment creation are idempotent per membership/renewal period.
   *
   * A failed charge deliberately leaves the membership untouched: it stays
   * `active` (not expired, not extended) and the `pending` payment is handed to
   * the existing retry/dunning flow by `PaymentRetryService.retryDuePayments()`,
   * which picks it up through `findDueRetries()` (next_retry_at IS NULL OR <=
   * now). The membership is only extended once a charge actually succeeds.
   */
  async renew(id: string): Promise<{ membership: Membership; payment: Payment }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const membership = await this.membershipRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    return this.renewOne(membership, new Date().toISOString().slice(0, 10));
  }

  /** WORKER-ONLY scan. Each candidate is revalidated under a row lock. */
  async renewDueMemberships(options: { limit?: number; today?: string } = {}): Promise<{
    scanned: number;
    renewed: number;
    membershipIds: string[];
  }> {
    const limit = options.limit ?? 200;
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    const candidates = await this.membershipRepository.createQueryBuilder('membership')
      .where('membership.status = :active', { active: MEMBERSHIP_STATUS.ACTIVE })
      .andWhere('membership.renewal_date IS NOT NULL')
      .andWhere('membership.renewal_date <= :today', { today })
      .orderBy('membership.renewal_date', 'ASC')
      .limit(limit)
      .getMany();
    const membershipIds: string[] = [];
    for (const candidate of candidates) {
      try {
        const result = await this.renewOne(candidate, today);
        if (result.payment.status === PAYMENT_STATUS.SUCCEEDED) membershipIds.push(candidate.id);
      } catch {
        // Isolate a bad renewal so one member cannot prevent the remainder of
        // the cross-organization batch from being considered.
      }
    }
    return { scanned: candidates.length, renewed: membershipIds.length, membershipIds };
  }

  private async renewOne(
    candidate: Membership,
    today: string,
  ): Promise<{ membership: Membership; payment: Payment }> {
    const created = await this.dataSource.transaction(async (manager) => {
      const memberships = manager.getRepository(Membership);
      const membership = await memberships.findOne({
        where: { id: candidate.id, organization_id: candidate.organization_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership || membership.status !== MEMBERSHIP_STATUS.ACTIVE ||
          !membership.end_date || !membership.renewal_date || membership.renewal_date > today) {
        throw new ConflictException('Membership is not due for renewal');
      }
      if (!membership.price_at_signup || Number(membership.price_at_signup) <= 0 || !membership.currency_at_signup) {
        throw new BadRequestException('Membership does not have a renewable price snapshot');
      }
      const invoices = manager.getRepository(Invoice);
      const plan = membership.plan_id
        ? await manager.getRepository(MembershipPlan).findOne({
            where: { id: membership.plan_id, organization_id: membership.organization_id },
          })
        : null;
      const durationDays = plan?.duration_days;
      if (!durationDays || durationDays < 1) throw new BadRequestException('Membership plan duration is unavailable');
      const idempotencyKey = `membership-renewal:${membership.id}:${membership.renewal_date}`;
      const existingPayment = await manager.getRepository(Payment).findOne({
        where: { organization_id: membership.organization_id, idempotency_key: idempotencyKey },
      });
      const dueInvoice = await invoices.createQueryBuilder('invoice')
        .innerJoin(InvoiceItem, 'item', 'item.invoice_id = invoice.id AND item.organization_id = invoice.organization_id')
        .where('invoice.organization_id = :organizationId', { organizationId: membership.organization_id })
        .andWhere('invoice.membership_id = :membershipId', { membershipId: membership.id })
        .andWhere('item.description LIKE :renewalDescription', { renewalDescription: 'Membership renewal%' })
        .andWhere('invoice.invoice_date >= :cycleStart', {
          cycleStart: new Date(`${membership.renewal_date}T00:00:00.000Z`),
        })
        .andWhere('invoice.status IN (:...statuses)', { statuses: ['sent', 'partially_paid', 'paid'] })
        .orderBy('invoice.invoice_date', 'DESC')
        .getOne();
      let invoice = dueInvoice;
      if (!invoice && existingPayment) {
        invoice = await invoices.findOne({
          where: { id: existingPayment.invoice_id, organization_id: membership.organization_id },
        });
      }
      if (!invoice) {
        // D5 fix — the renewal invoice must reflect an active discount.
        //
        // This is the only place a discount can reach an invoice at all: the
        // lookup in `create()` runs for a membership that was inserted moments
        // earlier, which by construction cannot have a discount row yet (see the
        // note on that lookup). Without the read below a
        // MEMBERSHIP_MEMBERSHIP_DISCOUNTS row is inert — it exists, the
        // `POST /v1/memberships/:id/discount` call returned 201, and the member
        // is charged full price on every cycle. Read on the caller's manager so
        // the discount is seen on the same connection/transaction as the invoice
        // write, and scoped by organization_id as well as membership_id.
        //
        // Predicate is identical to `create()`'s: in force now
        // (`starts_at <= now`) and not yet ended (`ends_at IS NULL OR > now`).
        const renewalAt = new Date();
        const discount = await manager.getRepository(MembershipDiscount).findOne({
          where: {
            membership_id: membership.id,
            organization_id: membership.organization_id,
            starts_at: LessThanOrEqual(renewalAt),
            ends_at: Or(IsNull(), MoreThan(renewalAt)),
          } as any,
        });
        const result = await this.invoicesService.createForMembershipSale({
          organizationId: membership.organization_id,
          memberId: membership.member_id,
          membershipId: membership.id,
          branchId: membership.branch_id,
          description: `Membership renewal${plan ? `: ${plan.name}` : ''}`,
          amount: membership.price_at_signup,
          discount: discount ? {
            id: discount.id,
            discount_type: discount.discount_type,
            amount: discount.amount,
          } : undefined,
          dueDate: new Date(),
          manager,
        });
        invoice = result.invoice;
      }
      const payments = manager.getRepository(Payment);
      let payment = existingPayment ?? await payments.findOne({
        where: { organization_id: membership.organization_id, invoice_id: invoice.id, idempotency_key: idempotencyKey },
      });
      if (!payment) {
        payment = await payments.save(payments.create({
          organization_id: membership.organization_id,
          branch_id: membership.branch_id ?? null,
          member_id: membership.member_id,
          invoice_id: invoice.id,
          payment_method: 'card',
          amount: invoice.total_amount,
          payment_date: new Date(),
          status: PAYMENT_STATUS.PENDING,
          idempotency_key: idempotencyKey,
          retry_count: 0,
          next_retry_at: null,
        }));
      }
      return { membership, payment, durationDays, cycleDate: membership.renewal_date };
    });

    // The gateway attempt happens OUTSIDE the transaction above: a network call
    // must never hold a row lock. A payment that is still pending after this has
    // been handed to the retry/dunning flow (see the `renew()` docblock).
    if (created.payment.status === PAYMENT_STATUS.PENDING &&
        (!created.payment.next_retry_at || created.payment.next_retry_at <= new Date())) {
      await this.paymentsService.attemptWithSavedMethod(created.payment, new Date(), 1);
    }
    const payment = await this.dataSource.getRepository(Payment).findOne({
      where: { id: created.payment.id, organization_id: created.membership.organization_id },
    });
    if (!payment) throw new NotFoundException('Renewal payment not found');
    if (payment.status === PAYMENT_STATUS.SUCCEEDED) {
      const updatedMembership = await this.dataSource.transaction(async (manager) => {
        const memberships = manager.getRepository(Membership);
        const membership = await memberships.findOne({
          where: { id: created.membership.id, organization_id: created.membership.organization_id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!membership) throw new NotFoundException('Membership not found');
        if (membership.renewal_date === created.membership.renewal_date) {
          const nextEndDate = addDaysToDate(membership.end_date!, created.durationDays);
          await memberships.update(
            { id: membership.id, organization_id: membership.organization_id },
            { end_date: nextEndDate, renewal_date: nextEndDate },
          );
          const history = manager.getRepository(MembershipHistory);
          await history.save(history.create({
            membership_id: membership.id,
            organization_id: membership.organization_id,
            member_id: membership.member_id,
            from_status: membership.status,
            to_status: membership.status,
            transition: 'renew',
            reason: 'Membership renewed after successful payment',
            metadata: { invoice_id: payment.invoice_id, payment_id: payment.id, end_date: nextEndDate },
          }));
          // Renewal is a membership state change, so it publishes an event like
          // every other transition — written on THIS transaction so the event and
          // the date extension commit or roll back together.
          //
          // `MembershipRenewed.v1` rather than the plan §5 suggestion of reusing
          // `MembershipExpired.v1`: §5 (line 448) assumed both names were net-new
          // contracts, but `MembershipRenewedPayload` is declared at
          // packages/contracts/src/events/membership.events.ts:17 and documented at
          // docs/event-contracts.md:44, both pre-dating Phase 3 — so no new event is
          // created either way. `MembershipExpired` additionally describes the
          // terminal expiry state ("transitioned to the terminal `expired` state",
          // membership.events.ts:46-47), which is the exact state this branch
          // avoided by extending the membership; emitting it would be false.
          //
          // Emitted inside the idempotency guard above, so a second scan of the
          // same cycle cannot publish it twice.
          await this.outboxService.saveEventEnvelope(
            'MembershipRenewed',          // EVENT_TYPES.MEMBERSHIP_RENEWED (membership.events.ts:111)
            MEMBERSHIP_EVENT_VERSION,     // EVENT_VERSIONS.V1
            membership.organization_id,   // from the row itself: org-pinned, never client-supplied
            {
              membershipId: membership.id,
              // `cycleDate` is the phase-1 lock's renewal_date, already narrowed to
              // a non-nullable string by the due-check guard above; re-reading it
              // here would widen it back to `string | undefined`.
              renewalDate: created.cycleDate,
              nextPaymentDate: nextEndDate,
              renewalFee: payment.amount,
            } as MembershipRenewedPayloadShape,
            membership.id,                // correlationId = membership id (existing convention)
            undefined,                    // causationId: not used for this event
            manager,                      // transaction-scoped: atomic with the date extension
          );
          membership.end_date = nextEndDate;
          membership.renewal_date = nextEndDate;
        }
        return membership;
      });
      return { membership: updatedMembership, payment };
    }
    return { membership: created.membership, payment };
  }

  /** Expire a single membership atomically, emitting MembershipExpired.v1. */
  private async expireOne(
    id: string,
    organizationId: string,
    today: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const membershipRepo = manager.getRepository(Membership);
      const historyRepo = manager.getRepository(MembershipHistory);

      const membership = await membershipRepo.findOne({
        where: { id, organization_id: organizationId } as any,
        lock: { mode: 'pessimistic_write' },
      });

      // Re-validate under the lock: another worker, a web request, or a prior
      // run may already have transitioned this membership out of a
      // non-terminal status.
      if (!membership) return false;
      if (!NON_TERMINAL_STATUSES.includes(membership.status as MembershipStatus)) {
        return false;
      }
      if (!membership.end_date || membership.end_date >= today) return false;

      // A due renewal invoice is the dunning hand-off. Do not expire a member
      // while its renewal debt is still open; P3-08 owns the subsequent chase.
      if (membership.renewal_date) {
        const openRenewal = await manager.getRepository(Invoice).createQueryBuilder('invoice')
          .innerJoin(InvoiceItem, 'item', 'item.invoice_id = invoice.id AND item.organization_id = invoice.organization_id')
          .where('invoice.organization_id = :organizationId', { organizationId })
          .andWhere('invoice.membership_id = :membershipId', { membershipId: membership.id })
          .andWhere('item.description LIKE :renewalDescription', { renewalDescription: 'Membership renewal%' })
          .andWhere('invoice.invoice_date >= :cycleStart', {
            cycleStart: new Date(`${membership.renewal_date}T00:00:00.000Z`),
          })
          .andWhere('invoice.status IN (:...statuses)', { statuses: ['sent', 'partially_paid'] })
          .getOne();
        if (openRenewal) return false;
      }

      await membershipRepo.update({ id, organization_id: organizationId } as any, {
        status: MEMBERSHIP_STATUS.EXPIRED,
      });

      const history = historyRepo.create({
        membership_id: id,
        organization_id: organizationId,
        member_id: membership.member_id,
        from_status: membership.status,
        to_status: MEMBERSHIP_STATUS.EXPIRED,
        transition: 'expire',
        reason: 'Membership end date reached',
      });
      await historyRepo.save(history);

      const payload: MembershipExpiredPayloadShape = {
        membershipId: membership.id,
        memberId: membership.member_id,
        expiredAt: new Date().toISOString(),
        endDate: membership.end_date,
      };
      await this.outboxService.saveEventEnvelope(
        'MembershipExpired',      // EVENT_TYPES.MEMBERSHIP_EXPIRED
        MEMBERSHIP_EVENT_VERSION, // EVENT_VERSIONS.V1
        organizationId,           // from the row itself: no tenant context available
        payload,
        membership.id,            // correlationId = membership id (existing convention)
        undefined,                // causationId: not used for this event
        manager,                  // transaction-scoped: atomic with the status write
      );

      return true;
    });
  }

  async create(dto: CreateMembershipDto): Promise<Membership> {
    const organizationId = await this.resolveAuthorizedOrg();
    const userId = await this.tenantContextService.getCurrentUserId();
    await this.ensureMemberBelongsToOrg(dto.member_id, organizationId);
    const plan = await this.ensureResourceBelongsToOrg(this.planRepository, dto.plan_id, organizationId, 'Membership plan', true);
    if (dto.branch_id) {
      const ok = await this.tenantContextService.validateBranchAccess(organizationId, dto.branch_id);
      if (!ok) throw new BadRequestException('Branch does not belong to the authorized organization');
    }
    const existingActive = await this.membershipRepository.findOne({
      where: { member_id: dto.member_id, organization_id: organizationId, status: MEMBERSHIP_STATUS.ACTIVE } as any,
    });
    if (existingActive) throw new ConflictException('Member already has an active membership');
    const startDate = dto.start_date || new Date().toISOString().split('T')[0];
    const endDate = dto.end_date || this.calculateEndDate(startDate, plan.duration_days);
    return this.dataSource.transaction(async (manager) => {
      const membershipRepo = manager.getRepository(Membership);
      const historyRepo = manager.getRepository(MembershipHistory);
      const membership = membershipRepo.create({
        member_id: dto.member_id, plan_id: dto.plan_id,
        branch_id: dto.branch_id || undefined, organization_id: organizationId,
        status: MEMBERSHIP_STATUS.ACTIVE, start_date: startDate, end_date: endDate,
        renewal_date: endDate, price_at_signup: plan.price, currency_at_signup: plan.currency,
      });
      const saved = await membershipRepo.save(membership);
      const history = historyRepo.create({
        membership_id: saved.id, organization_id: organizationId, member_id: dto.member_id,
        from_status: undefined, to_status: MEMBERSHIP_STATUS.ACTIVE, transition: 'create',
        reason: 'Membership created', changed_by: userId || undefined,
        metadata: { plan_id: dto.plan_id, plan_name: plan.name, price: plan.price, currency: plan.currency },
      });
      await historyRepo.save(history);
      // The sale's invoice (if the plan costs anything) is generated INSIDE this
      // transaction, so a rolled-back membership write can never leave an orphan
      // invoice, and a failed invoice can never leave a membership without one.
      if (Number(plan.price) > 0) {
        const saleAt = new Date();
        // DEAD IN PRODUCTION — kept deliberately, pending a separate decision.
        //
        // This lookup cannot match, and that is structural, not a bug in the
        // predicate: `addDiscount()` only writes a discount for a membership that
        // ALREADY exists (it 404s on an unknown id), while `saved` was inserted
        // three statements above, inside this same transaction. A
        // MEMBERSHIP_MEMBERSHIP_DISCOUNTS row for `saved.id` therefore cannot
        // exist yet, so `discount` is always null here and the ternary below
        // always passes `discount: undefined`.
        //
        // An active discount does reach invoices — on the renewal path, which is
        // where a discount can be in force at the moment an invoice is raised
        // (`renewOne`). Keeping this block is intentional: whether a discount
        // should also apply at sale time is an open design question (answering it
        // means loosening `addDiscount`'s precondition), and deleting this
        // read would prejudge that. Do not read its presence as evidence that
        // sale-time discounts work.
        const discount = await this.discountRepository.findOne({
          where: {
            membership_id: saved.id,
            organization_id: organizationId,
            starts_at: LessThanOrEqual(saleAt),
            ends_at: Or(IsNull(), MoreThan(saleAt)),
          } as any,
        });
        await this.invoicesService.createForMembershipSale({
          organizationId,
          memberId: dto.member_id,
          membershipId: saved.id,
          branchId: dto.branch_id || undefined,
          description: `Membership: ${plan.name}`,
          amount: plan.price,
          discount: discount ? {
            id: discount.id,
            discount_type: discount.discount_type,
            amount: discount.amount,
          } : undefined,
          manager,
        });
      }
      await this.outboxService.saveEventEnvelope(
        'MembershipStarted',                                     // EVENT_TYPES.MEMBERSHIP_STARTED (membership.events.ts:88)
        MEMBERSHIP_EVENT_VERSION,                                // EVENT_VERSIONS.V1 (membership.events.ts:99-101)
        organizationId,                                          // authorized org (server-derived, never from DTO)
        {
          membershipId: saved.id, memberId: saved.member_id, planId: saved.plan_id,
          startDate: saved.start_date, initialFee: plan.price,
        } as MembershipStartedPayloadShape,
        saved.id,                                                // correlationId = membership id (existing convention)
        undefined,                                               // causationId: not used for this event
        manager,                                                 // transaction-scoped: event commits/rolls back with the membership
      );
      return saved;
    });
  }

  async update(id: string, dto: UpdateMembershipDto): Promise<Membership> {
    const organizationId = await this.resolveAuthorizedOrg();
    const membership = await this.membershipRepository.findOne({ where: { id, organization_id: organizationId } as any });
    if (!membership) throw new NotFoundException('Membership not found');
    if (dto.plan_id && dto.plan_id !== membership.plan_id) {
      await this.ensureResourceBelongsToOrg(this.planRepository, dto.plan_id, organizationId, 'Membership plan', true);
    }
    if (dto.branch_id && dto.branch_id !== membership.branch_id) {
      const ok = await this.tenantContextService.validateBranchAccess(organizationId, dto.branch_id);
      if (!ok) throw new BadRequestException('Branch does not belong to the authorized organization');
    }
    const updates: Partial<Membership> = {};
    if (dto.plan_id !== undefined) updates.plan_id = dto.plan_id;
    if (dto.branch_id !== undefined) updates.branch_id = dto.branch_id;
    if (dto.start_date !== undefined) updates.start_date = dto.start_date;
    if (dto.end_date !== undefined) updates.end_date = dto.end_date;
    await this.membershipRepository.update({ id, organization_id: organizationId } as any, updates);
    return this.findOne(id);
  }

  async addDiscount(id: string, dto: CreateMembershipDiscountDto): Promise<MembershipDiscount> {
    const organizationId = await this.resolveAuthorizedOrg();
    const membership = await this.membershipRepository.findOne({ where: { id, organization_id: organizationId } as any });
    if (!membership) throw new NotFoundException('Membership not found');
    const startsAt = dto.starts_at ? new Date(dto.starts_at) : new Date();
    const endsAt = dto.ends_at ? new Date(dto.ends_at) : null;
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('ends_at must be after starts_at');
    // Mirrors the table's CHK_membership_discounts_amount check (`amount <= 100`
    // for a percentage). Without this guard a 150% discount passes DTO validation
    // (the DTO caps every type at 1_000_000_000_000) and violates the constraint,
    // and there is no QueryFailedError filter anywhere in the API to turn that
    // database error into a 4xx — so it would surface as a raw 500.
    if (dto.discount_type === 'percentage' && dto.amount > 100) {
      throw new BadRequestException('A percentage discount cannot exceed 100');
    }
    return this.dataSource.transaction(async (manager) => {
      const membershipRepository = manager.getRepository(Membership);
      const lockedMembership = await membershipRepository.findOne({
        where: { id, organization_id: organizationId } as any,
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedMembership) throw new NotFoundException('Membership not found');

      const repository = manager.getRepository(MembershipDiscount);
      // The window belongs IN the query. The previous guard read one arbitrary
      // row (`findOne` with no `order`, then an activity test in TypeScript) and
      // assumed a membership can only own one row. That assumption is not
      // enforced by the schema: `UQ_membership_discounts_one_active` is a
      // PARTIAL unique index (`WHERE ends_at IS NULL`), so a row that carries an
      // `ends_at` is invisible to it and two rows per membership are legal —
      // which is exactly what a create/expire/create cycle leaves behind. With
      // both rows present Postgres returned the EXPIRED one (no Sort node in the
      // plan, so heap order decided), the condition below evaluated false, and a
      // second active discount was accepted. See
      // `membership-discount-ambiguity.integration.spec.ts`, which pins the raw
      // plan behaviour and the rejection.
      //
      // Predicate identical to `renewOne`'s and `create()`'s: in force now
      // (`starts_at <= now`) and not yet ended (`ends_at IS NULL OR > now`).
      const inForceAt = new Date();
      const existing = await repository.findOne({
        where: {
          membership_id: id,
          organization_id: organizationId,
          starts_at: LessThanOrEqual(inForceAt),
          ends_at: Or(IsNull(), MoreThan(inForceAt)),
        } as any,
      });
      if (existing) {
        throw new ConflictException('Membership already has an active discount');
      }
      try {
        return await repository.save(repository.create({
          membership_id: id,
          organization_id: organizationId,
          discount_type: dto.discount_type,
          amount: dto.amount.toFixed(2),
          starts_at: startsAt,
          ends_at: endsAt,
        }));
      } catch (error) {
        // The window check above is a belt, not the whole guard: a row that
        // starts in the FUTURE (`starts_at > now`, `ends_at IS NULL`) is not in
        // force now, so that predicate skips it and a second open-ended row can
        // still reach this INSERT. The real guard is the partial unique index
        // UQ_membership_discounts_one_active on `(membership_id) WHERE ends_at
        // IS NULL`, and the decision is taken here — the same shape as the
        // payout-period race in commission-payouts.service.ts. Mapping the
        // SQLSTATE to the guard's own message keeps the loser a controlled 409
        // instead of an unhandled QueryFailedError (500). The transaction is
        // already aborted at this point, so nothing may be queried inside it.
        // On THIS insert a 23505 can only be that index: the PK is
        // database-generated, FK failures are 23503 and CHECK failures 23514.
        if (MembershipsService.isUniqueViolation(error)) {
          throw new ConflictException('Membership already has an active discount');
        }
        throw error;
      }
    });
  }

  private async transitionState(id: string, targetStatus: MembershipStatus, dto: MembershipLifecycleDto): Promise<Membership> {
    const organizationId = await this.resolveAuthorizedOrg();
    const userId = await this.tenantContextService.getCurrentUserId();
    const membership = await this.membershipRepository.findOne({ where: { id, organization_id: organizationId } as any });
    if (!membership) throw new NotFoundException('Membership not found');
    const currentStatus = membership.status;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) throw new BadRequestException(`Invalid transition from '${currentStatus}' to '${targetStatus}'`);
    const transitionKey = `${currentStatus}->${targetStatus}`;
    const transitionName = TRANSITION_NAMES[transitionKey] || targetStatus;
    return this.dataSource.transaction(async (manager) => {
      const membershipRepo = manager.getRepository(Membership);
      const historyRepo = manager.getRepository(MembershipHistory);
      const updates: Partial<Membership> = { status: targetStatus };
      const now = new Date();
      if (targetStatus === MEMBERSHIP_STATUS.CANCELLED) { updates.cancelled_at = now; updates.cancellation_reason = dto.reason || undefined; }
      if (targetStatus === MEMBERSHIP_STATUS.PAUSED) updates.paused_at = now;
      if (targetStatus === MEMBERSHIP_STATUS.FROZEN) updates.frozen_at = now;
      let effectiveEndDate: string | undefined;
      if (targetStatus === MEMBERSHIP_STATUS.ACTIVE) {
        if (currentStatus === MEMBERSHIP_STATUS.PAUSED) { updates.paused_at = null as any; updates.pause_end_at = null as any; }
        if (currentStatus === MEMBERSHIP_STATUS.FROZEN) {
          updates.frozen_at = null as any;
          // Extend the membership's end_date by the number of whole calendar days
          // frozen, so frozen time is not deducted from the paid term.
          if (membership.end_date && membership.frozen_at) {
            const frozenDays = diffDays(membership.frozen_at, now);
            if (frozenDays >= 1) {
              updates.end_date = addDaysToDate(membership.end_date, frozenDays);
            }
          }
        }
        // Both resume and unfreeze report the corrected end_date (extended term).
        effectiveEndDate = updates.end_date || membership.end_date;
      }
      await membershipRepo.update({ id, organization_id: organizationId } as any, updates);
      const history = historyRepo.create({
        membership_id: id, organization_id: organizationId, member_id: membership.member_id,
        from_status: currentStatus, to_status: targetStatus, transition: transitionName,
        reason: dto.reason || undefined, changed_by: userId || undefined,
      });
      await historyRepo.save(history);
      const eventPayload = this.buildLifecycleEventPayload(transitionName, membership, dto, effectiveEndDate);
      if (eventPayload) {
        await this.outboxService.saveEventEnvelope(
          eventPayload.eventType,
          MEMBERSHIP_EVENT_VERSION,
          organizationId,
          eventPayload.payload,
          membership.id,
          undefined,
          manager,
        );
      }
      return membershipRepo.findOne({ where: { id, organization_id: organizationId } as any }) as Promise<Membership>;
    });
  }

  async pause(id: string, dto: MembershipLifecycleDto = {}): Promise<Membership> { return this.transitionState(id, MEMBERSHIP_STATUS.PAUSED as MembershipStatus, dto); }
  async resume(id: string, dto: MembershipLifecycleDto = {}): Promise<Membership> { return this.transitionState(id, MEMBERSHIP_STATUS.ACTIVE as MembershipStatus, dto); }
  async freeze(id: string, dto: MembershipLifecycleDto = {}): Promise<Membership> { return this.transitionState(id, MEMBERSHIP_STATUS.FROZEN as MembershipStatus, dto); }
  async unfreeze(id: string, dto: MembershipLifecycleDto = {}): Promise<Membership> { return this.transitionState(id, MEMBERSHIP_STATUS.ACTIVE as MembershipStatus, dto); }
  async cancel(id: string, dto: MembershipLifecycleDto = {}): Promise<Membership> { return this.transitionState(id, MEMBERSHIP_STATUS.CANCELLED as MembershipStatus, dto); }
  async expire(id: string, dto: MembershipLifecycleDto = {}): Promise<Membership> { return this.transitionState(id, MEMBERSHIP_STATUS.EXPIRED as MembershipStatus, dto); }

  private calculateEndDate(startDate: string, durationDays: number): string {
    const start = new Date(startDate);
    start.setDate(start.getDate() + durationDays);
    return start.toISOString().split('T')[0];
  }

  private buildLifecycleEventPayload(transitionName: string, membership: Membership, dto: MembershipLifecycleDto, effectiveEndDate?: string): { eventType: string; payload: Record<string, any> } | null {
    switch (transitionName) {
      case 'pause': return { eventType: 'MembershipPaused', payload: { membershipId: membership.id, pauseStartDate: new Date().toISOString(), pauseFee: '0' } };
      case 'resume': {
        const resumeDate = new Date().toISOString();
        const endDate = effectiveEndDate || membership.end_date;
        const remainingDays = endDate ? diffDays(new Date(resumeDate), new Date(endDate + 'T00:00:00Z')) : 0;
        return { eventType: 'MembershipResumed', payload: { membershipId: membership.id, resumeDate, remainingDays } };
      }
      case 'freeze': {
        const freezeStartDate = new Date().toISOString();
        // freezeDurationDays is a placeholder until the freeze-duration feature is implemented.
        // Currently all freezes are open-ended (see docs/event-contracts.md — freezeEndDate
        // is documented as optional for this reason).
        return { eventType: 'MembershipFreezeStarted', payload: { membershipId: membership.id, freezeStartDate, freezeDurationDays: 0 } };
      }
      case 'unfreeze': {
        const freezeEndDate = new Date().toISOString();
        const endDate = effectiveEndDate || membership.end_date;
        const daysRemaining = endDate ? diffDays(new Date(freezeEndDate), new Date(endDate + 'T00:00:00Z')) : 0;
        return { eventType: 'MembershipFreezeEnded', payload: { membershipId: membership.id, freezeEndDate, actualEndDate: endDate, daysRemaining } };
      }
      case 'cancel': return { eventType: 'MembershipCancelled', payload: { membershipId: membership.id, cancellationDate: new Date().toISOString(), reason: dto.reason } };
      case 'expire': return { eventType: 'MembershipExpired', payload: { membershipId: membership.id, memberId: membership.member_id, expiredAt: new Date().toISOString(), endDate: membership.end_date } };
      default: return null;
    }
  }

  private static isUniqueViolation(error: unknown): boolean {
    const candidate = error as { code?: string; driverError?: { code?: string } };
    return (candidate?.driverError?.code ?? candidate?.code) === UNIQUE_VIOLATION_CODE;
  }
}

export { MEMBERSHIP_STATUS, MembershipStatus, VALID_TRANSITIONS, TRANSITION_NAMES, NON_TERMINAL_STATUSES };
