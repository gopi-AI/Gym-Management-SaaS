import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyRule } from '../entities/loyalty-rule.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  LOYALTY_TRIGGER_EVENTS,
  LOYALTY_TRANSACTION_TYPES,
  LOYALTY_REFERENCE_TYPES,
  LOYALTY_EVENT_TYPES,
  LOYALTY_EVENT_VERSION,
  DEFAULT_POINTS_EXPIRY_DAYS,
} from '../loyalty.constants';

/**
 * Input payload for the `check_in` trigger (mirrors AttendanceEventRecordedPayload).
 */
export interface CheckInEventInput {
  organizationId: string;
  memberId: string;
  /** From the AttendanceEventRecorded.v1 payload — must be 'CHECK_IN'. */
  eventType: string;
  /** The raw attendance event id (ATTENDANCE_ATTENDANCE_EVENTS.id). */
  eventId?: string;
  /** The attendance record id (correlationId of the envelope). */
  attendanceRecordId?: string;
  eventTime?: string;
}

/**
 * Input payload for the `workout_logged` trigger (mirrors WorkoutSessionLoggedPayload).
 *
 * NO PRODUCER EXISTS IN PHASE 2 — this handler is built against the defined
 * contract and is inert until the Workouts module emits `WorkoutSessionLogged.v1`.
 */
export interface WorkoutLoggedEventInput {
  organizationId: string;
  memberId: string;
  sessionId: string;
  sessionDate?: string;
}

export interface AccrualResult {
  awarded: boolean;
  accountId?: string;
  transactionId?: string;
  points?: number;
  /** Human-readable reason when no points were awarded. */
  reason: string;
}

/**
 * Loyalty accrual — the module's synchronous event consumer (see §12 Q21).
 *
 * This service is the inbox consumer handler: given an inbound domain event it matches
 * a LoyaltyRule, enforces the per-day cap, and writes the earn transaction plus the
 * account balance update in ONE DB transaction, then emits `LoyaltyPointsAwarded.v1`
 * through the transactional outbox.
 *
 * WIRING GAP: this handler is NOT currently wired to fire automatically. The
 * outbox-to-consumer routing layer does not exist anywhere in this codebase (the
 * OutboxPoller only logs events and marks them processed; nothing dispatches them to
 * consumers). Every outbox event ever written by producer modules is persisted but
 * never consumed. Wiring this handler into a real event-delivery pipeline is a
 * foundational, project-wide follow-up task — not a Loyalty-module concern.
 */
@Injectable()
export class LoyaltyAccrualService {
  private readonly logger = new Logger(LoyaltyAccrualService.name);

  constructor(
    @InjectRepository(LoyaltyAccount)
    private readonly accountRepository: Repository<LoyaltyAccount>,
    @InjectRepository(LoyaltyTransaction)
    private readonly transactionRepository: Repository<LoyaltyTransaction>,
    @InjectRepository(LoyaltyRule)
    private readonly ruleRepository: Repository<LoyaltyRule>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Process an inbound `AttendanceEventRecorded.v1` event.
   *
   * Filters to `CHECK_IN` events only (CHECK_OUT and other kinds are ignored).
   * Fully unit-tested but not live-wired (see class-level wiring-gap note).
   */
  async handleCheckIn(input: CheckInEventInput): Promise<AccrualResult> {
    if (input.eventType !== 'CHECK_IN') {
      return {
        awarded: false,
        reason: `Ignored eventType=${input.eventType}; only CHECK_IN earns points`,
      };
    }
    return this.awardForTrigger({
      organizationId: input.organizationId,
      memberId: input.memberId,
      triggerEvent: LOYALTY_TRIGGER_EVENTS.CHECK_IN,
      referenceType: LOYALTY_REFERENCE_TYPES.CHECK_IN,
      referenceId: input.eventId ?? null,
      description: 'Check-in at the gym',
      occurredAt: input.eventTime ? new Date(input.eventTime) : new Date(),
    });
  }

  /**
   * Process an inbound `WorkoutSessionLogged.v1` event.
   *
   * The consumer logic is implemented against the defined contract, but there is no
   * producer in Phase 2 (the Workouts module does not emit this event). This
   * handler correctly does nothing when no such event is delivered — proven by tests.
   */
  async handleWorkoutLogged(input: WorkoutLoggedEventInput): Promise<AccrualResult> {
    return this.awardForTrigger({
      organizationId: input.organizationId,
      memberId: input.memberId,
      triggerEvent: LOYALTY_TRIGGER_EVENTS.WORKOUT_LOGGED,
      referenceType: LOYALTY_REFERENCE_TYPES.WORKOUT_SESSION,
      referenceId: input.sessionId,
      description: 'Workout session logged',
      occurredAt: input.sessionDate ? new Date(input.sessionDate) : new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // Core accrual: shared by both triggers
  // -------------------------------------------------------------------------

  private async awardForTrigger(params: {
    organizationId: string;
    memberId: string;
    triggerEvent: string;
    referenceType: string;
    referenceId: string | null;
    description: string;
    occurredAt: Date;
  }): Promise<AccrualResult> {
    const rule = await this.ruleRepository.findOne({
      where: {
        organization_id: params.organizationId,
        trigger_event: params.triggerEvent,
        is_active: true,
      },
    });
    if (!rule) {
      return { awarded: false, reason: `No active ${params.triggerEvent} rule for org ${params.organizationId}` };
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const account = await this.getOrCreateAccount(manager, params);

        if (await this.reachedDailyCap(
          manager, account.id, params.referenceType, params.occurredAt, rule.max_per_day,
        )) {
          return { awarded: false, reason: `Daily cap (${rule.max_per_day}) reached for ${params.triggerEvent}` };
        }

        const org = await manager.getRepository(Organization).findOne({
          where: { id: params.organizationId },
        });
        const expiryDays = org?.points_expiry_days ?? DEFAULT_POINTS_EXPIRY_DAYS;
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);

        const txn = manager.getRepository(LoyaltyTransaction).create({
          account_id: account.id,
          // NOT NULL since 1788965263403-AddOrganizationIdToLoyaltyTransactions.ts.
          // Already in scope: the rule lookup above is scoped by this same org.
          organization_id: params.organizationId,
          transaction_type: LOYALTY_TRANSACTION_TYPES.EARN,
          points: rule.points_per_event,
          remaining_points: rule.points_per_event,
          reference_type: params.referenceType,
          reference_id: params.referenceId,
          description: params.description,
          expires_at: expiresAt,
        });
        const savedTxn = await manager.getRepository(LoyaltyTransaction).save(txn);

        await manager.getRepository(LoyaltyAccount).increment(
          { id: account.id }, 'balance', rule.points_per_event,
        );
        await manager.getRepository(LoyaltyAccount).increment(
          { id: account.id }, 'lifetime_points_earned', rule.points_per_event,
        );

        await this.outboxService.saveEventEnvelope(
          LOYALTY_EVENT_TYPES.LOYALTY_POINTS_AWARDED,
          LOYALTY_EVENT_VERSION,
          params.organizationId,
          {
            accountId: account.id,
            memberId: params.memberId,
            points: rule.points_per_event,
            transactionId: savedTxn.id,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
            description: params.description,
          },
          savedTxn.id,
          undefined,
          manager,
        );

        return {
          awarded: true,
          accountId: account.id,
          transactionId: savedTxn.id,
          points: rule.points_per_event,
          reason: `Awarded ${rule.points_per_event} pts for ${params.triggerEvent}`,
        };
      });
    } catch (error) {
      this.logger.error(
        `Loyalty accrual failed for ${params.triggerEvent}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { awarded: false, reason: `Accrual error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async getOrCreateAccount(
    manager: EntityManager,
    params: { organizationId: string; memberId: string },
  ): Promise<LoyaltyAccount> {
    const repo = manager.getRepository(LoyaltyAccount);
    const existing = await repo.findOne({
      where: { organization_id: params.organizationId, member_id: params.memberId },
    });
    if (existing) return existing;
    const created = repo.create({
      organization_id: params.organizationId,
      member_id: params.memberId,
      balance: 0,
      lifetime_points_earned: 0,
      lifetime_points_redeemed: 0,
      tier: null,
    });
    return repo.save(created);
  }

  private async reachedDailyCap(
    manager: EntityManager,
    accountId: string,
    referenceType: string,
    day: Date,
    maxPerDay: number,
  ): Promise<boolean> {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const count = await manager
      .getRepository(LoyaltyTransaction)
      .createQueryBuilder('txn')
      .where('txn.account_id = :accountId', { accountId })
      .andWhere('txn.reference_type = :referenceType', { referenceType })
      .andWhere('txn.transaction_type = :txnType', { txnType: LOYALTY_TRANSACTION_TYPES.EARN })
      .andWhere('txn.created_at >= :start', { start })
      .andWhere('txn.created_at <= :end', { end })
      .getCount();

    return count >= maxPerDay;
  }
}
