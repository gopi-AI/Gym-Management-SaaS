import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Membership } from '../entities/membership.entity';
import { MembershipHistory } from '../entities/membership-history.entity';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { CreateMembershipDto } from '../dto/create-membership.dto';
import { UpdateMembershipDto } from '../dto/update-membership.dto';
import { QueryMembershipDto } from '../dto/query-membership.dto';
import { MembershipLifecycleDto } from '../dto/membership-lifecycle.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { InvoicesService } from '../../finance/services/invoices.service';

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

@Injectable()
export class MembershipsService {
  constructor(
    @InjectRepository(Membership)
    private readonly membershipRepository: Repository<Membership>,
    @InjectRepository(MembershipPlan)
    private readonly planRepository: Repository<MembershipPlan>,
    @InjectRepository(MembershipHistory)
    private readonly historyRepository: Repository<MembershipHistory>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
    private readonly invoicesService: InvoicesService,
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
        await this.invoicesService.createForMembershipSale({
          organizationId,
          memberId: dto.member_id,
          membershipId: saved.id,
          branchId: dto.branch_id || undefined,
          description: `Membership: ${plan.name}`,
          amount: plan.price,
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
}

export { MEMBERSHIP_STATUS, MembershipStatus, VALID_TRANSITIONS, TRANSITION_NAMES, NON_TERMINAL_STATUSES };
