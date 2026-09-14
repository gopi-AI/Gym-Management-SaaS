import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AttendanceEvent } from '../entities/attendance-event.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { AttendanceAccessDecision } from '../entities/attendance-access-decision.entity';
import { AttendanceEventDto } from '../dto/attendance-event.dto';
import { QueryAttendanceRecordsDto } from '../dto/query-attendance-records.dto';
import { QueryAccessDecisionsDto } from '../dto/query-access-decisions.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { MembershipsService } from '../../memberships/services/memberships.service';
import { endOfRange } from '../../shared/utils/date-range';
import {
  ATTENDANCE_DECISION_REASONS,
  ATTENDANCE_EVENT_KINDS,
  ATTENDANCE_EVENT_TYPES,
  ATTENDANCE_EVENT_VERSION,
  ATTENDANCE_METHODS,
  attendanceDenialMessage,
} from '../attendance.constants';

/**
 * Structural mirror of AttendanceEventRecordedPayload in
 * packages/contracts/src/events/attendance.events.ts (which mirrors
 * `docs/event-contracts.md` §Attendance Events).
 *
 * `checkInMethod` / `checkOutMethod` / `checkedInBy` are optional,
 * backward-compatible additions (see the contract file): they are what let a
 * consumer tell a manual front-desk event — and the staff member who recorded it
 * — apart from a future device event.
 */
interface AttendanceEventRecordedPayloadShape extends Record<string, unknown> {
  eventId: string;
  deviceId: string | null;
  memberId: string;
  eventTime: string;
  eventType: string;
  biometricId: string | null;
  checkInMethod?: string;
  checkOutMethod?: string;
  checkedInBy?: string | null;
}

/** Successful outcome of an attendance event. */
export interface AttendanceEventResult {
  event: AttendanceEvent;
  decision: AttendanceAccessDecision;
  record: AttendanceRecord;
}

/**
 * Internal shape of a processed event. A denial is RETURNED (not thrown) so the
 * audit rows — the event and the refused access decision — are committed before
 * the caller is told "no"; it is only translated into an HTTP error afterwards.
 */
type AttendanceOutcome =
  | { granted: true; result: AttendanceEventResult }
  | { granted: false; reason: string; eventId: string; decisionId: string };

/**
 * Everything the check-in/check-out logic needs, resolved once by `recordEvent`:
 * the authorized organization, the member, the optional branch, the server-side
 * event time and the authenticated staff user (audit attribution).
 */
interface AttendanceEventInput {
  organizationId: string;
  memberId: string;
  branchId?: string;
  eventTime: Date;
  userId: string | null;
}

/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceRecord)
    private readonly recordRepository: Repository<AttendanceRecord>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @InjectRepository(AttendanceAccessDecision)
    private readonly decisionRepository: Repository<AttendanceAccessDecision>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
    private readonly membershipsService: MembershipsService,
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
   * Check a member in (`POST /v1/attendance/events`).
   *
   * Evaluates the member's memberships before the door opens, records the access
   * decision either way, and opens the attendance session when the member is
   * allowed in. The timestamp is generated here, never by the client.
   */
  async recordCheckIn(dto: AttendanceEventDto): Promise<AttendanceEventResult> {
    const input = await this.resolveEventInput(dto);
    return this.checkIn(input);
  }

  /**
   * Check a member out (`POST /v1/attendance/check-out`).
   *
   * Closes the member's open session and records the access decision.
   */
  async recordCheckOut(dto: AttendanceEventDto): Promise<AttendanceEventResult> {
    const input = await this.resolveEventInput(dto);
    return this.checkOut(input);
  }

  /**
   * Validate the caller's member/branch context and stamp the event time.
   *
   * Shared by both event kinds so a check-out can never skip the tenant and
   * branch checks a check-in performs.
   */
  private async resolveEventInput(dto: AttendanceEventDto): Promise<AttendanceEventInput> {
    const organizationId = await this.resolveAuthorizedOrg();
    const userId = await this.tenantContextService.getCurrentUserId();
    await this.ensureMemberBelongsToOrg(dto.member_id, organizationId);

    if (dto.branch_id) {
      const ok = await this.tenantContextService.validateBranchAccess(organizationId, dto.branch_id);
      if (!ok) {
        throw new BadRequestException('Branch does not belong to the authorized organization');
      }
    }

    return {
      organizationId,
      memberId: dto.member_id,
      branchId: dto.branch_id,
      eventTime: new Date(),
      userId,
    };
  }

  /** Paginated attendance records (`GET /v1/attendance/records`). */
  async findRecords(query: QueryAttendanceRecordsDto): Promise<{
    data: AttendanceRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const qb = this.recordRepository
      .createQueryBuilder('record')
      .where('record.organization_id = :organizationId', { organizationId });

    if (query.member_id) {
      qb.andWhere('record.member_id = :memberId', { memberId: query.member_id });
    }
    if (query.branch_id) {
      qb.andWhere('record.branch_id = :branchId', { branchId: query.branch_id });
    }
    if (query.check_in_method) {
      qb.andWhere('record.check_in_method = :method', { method: query.check_in_method });
    }
    if (query.from) {
      qb.andWhere('record.check_in_time >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('record.check_in_time <= :to', { to: endOfRange(query.to) });
    }
    if (query.open_only) {
      qb.andWhere('record.check_out_time IS NULL');
    }

    const [data, total] = await qb
      .orderBy('record.check_in_time', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  /** Single attendance record, scoped to the authorized organization. */
  async findRecord(id: string): Promise<AttendanceRecord> {
    const organizationId = await this.resolveAuthorizedOrg();
    const record = await this.recordRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  /**
   * Paginated access decisions (`GET /v1/attendance/access-decisions`).
   *
   * The decisions table has no `organization_id` (docs/database-plan.md ERD), so
   * the tenant scope comes from the attendance event it belongs to — the inner
   * join is what makes a cross-tenant read impossible. `member_id`/`branch_id`
   * filter on the same event.
   */
  async findAccessDecisions(query: QueryAccessDecisionsDto): Promise<{
    data: AttendanceAccessDecision[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const qb = this.decisionRepository
      .createQueryBuilder('decision')
      .innerJoin(AttendanceEvent, 'event', 'event.id = decision.attendance_event_id')
      .where('event.organization_id = :organizationId', { organizationId });

    if (query.member_id) {
      qb.andWhere('event.member_id = :memberId', { memberId: query.member_id });
    }
    if (query.branch_id) {
      qb.andWhere('event.branch_id = :branchId', { branchId: query.branch_id });
    }
    if (query.is_granted !== undefined) {
      qb.andWhere('decision.is_granted = :isGranted', { isGranted: query.is_granted });
    }
    if (query.from) {
      qb.andWhere('decision.decided_at >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('decision.decided_at <= :to', { to: endOfRange(query.to) });
    }

    const [data, total] = await qb
      .select('decision')
      .orderBy('decision.decided_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  /**
   * CHECK_IN: write the raw event, evaluate membership eligibility, write the
   * access decision, and — only when the member is allowed in — open the
   * attendance session. Event, decision, session and the
   * `AttendanceEventRecorded.v1` envelope share ONE transaction, so a granted
   * check-in can never exist without its audit trail (or vice versa).
   *
   * Eligibility rules are NOT duplicated here: they are read from the module that
   * owns the membership state machine
   * (`MembershipsService.getCheckInEligibility`).
   */
  private async checkIn(input: AttendanceEventInput): Promise<AttendanceEventResult> {
    let outcome: AttendanceOutcome;

    try {
      outcome = await this.dataSource.transaction(async (manager) => {
        const event = await this.createEvent(manager, input, ATTENDANCE_EVENT_KINDS.CHECK_IN);

        const eligibility = await this.membershipsService.getCheckInEligibility(
          input.memberId,
          input.organizationId,
          input.eventTime,
        );
        if (!eligibility.eligible) {
          const decision = await this.saveDecision(manager, event.id, false, eligibility.reason);
          return {
            granted: false,
            reason: eligibility.reason,
            eventId: event.id,
            decisionId: decision.id,
          };
        }

        // Row lock on any open session: a second request waits here and then sees
        // the newly opened session instead of opening a duplicate one.
        const openRecord = await this.findOpenRecord(manager, input);
        if (openRecord) {
          const reason = ATTENDANCE_DECISION_REASONS.ALREADY_CHECKED_IN;
          const decision = await this.saveDecision(manager, event.id, false, reason);
          return { granted: false, reason, eventId: event.id, decisionId: decision.id };
        }

        const recordRepository = manager.getRepository(AttendanceRecord);
        const record = await recordRepository.save(
          recordRepository.create({
            organization_id: input.organizationId,
            branch_id: input.branchId ?? null,
            member_id: input.memberId,
            check_in_time: input.eventTime,
            check_out_time: null,
            check_in_method: ATTENDANCE_METHODS.MANUAL,
            check_out_method: null,
            checked_in_by: input.userId ?? null,
          }),
        );

        const decision = await this.saveDecision(manager, event.id, true, null);
        await this.emitEventRecorded(
          manager,
          input,
          record,
          ATTENDANCE_EVENT_KINDS.CHECK_IN,
          event,
        );

        return { granted: true, result: { event, decision, record } };
      });
    } catch (error) {
      // Two concurrent check-ins for the same member: the partial unique index on
      // "open session" rejects the loser, whose transaction (audit rows included)
      // rolls back — the winning request already recorded the same attempt.
      if (AttendanceService.isUniqueViolation(error)) {
        throw new ConflictException(
          attendanceDenialMessage(ATTENDANCE_DECISION_REASONS.ALREADY_CHECKED_IN),
        );
      }
      throw error;
    }

    return this.unwrap(outcome);
  }

  /**
   * CHECK_OUT: close the member's open session. A check-out with no open session
   * is a state conflict, recorded as a refused access decision before it is
   * reported.
   */
  private async checkOut(input: AttendanceEventInput): Promise<AttendanceEventResult> {
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<AttendanceOutcome> => {
        const event = await this.createEvent(manager, input, ATTENDANCE_EVENT_KINDS.CHECK_OUT);

        const openRecord = await this.findOpenRecord(manager, input);
        if (!openRecord) {
          const reason = ATTENDANCE_DECISION_REASONS.NO_OPEN_CHECK_IN;
          const decision = await this.saveDecision(manager, event.id, false, reason);
          return { granted: false, reason, eventId: event.id, decisionId: decision.id };
        }

        const recordRepository = manager.getRepository(AttendanceRecord);
        openRecord.check_out_time = input.eventTime;
        openRecord.check_out_method = ATTENDANCE_METHODS.MANUAL;
        const record = await recordRepository.save(openRecord);

        const decision = await this.saveDecision(manager, event.id, true, null);
        await this.emitEventRecorded(
          manager,
          input,
          record,
          ATTENDANCE_EVENT_KINDS.CHECK_OUT,
          event,
        );

        return { granted: true, result: { event, decision, record } };
      },
    );

    return this.unwrap(outcome);
  }

  private static isUniqueViolation(error: unknown): boolean {
    const candidate = error as { code?: string; driverError?: { code?: string } };
    return (candidate?.driverError?.code ?? candidate?.code) === UNIQUE_VIOLATION_CODE;
  }

  /**
   * Translate a committed denial into the HTTP error the front desk sees.
   *
   * Called only AFTER the transaction committed, because the audit rows (the
   * event and the refused access decision) must survive the rejection.
   */
  private unwrap(outcome: AttendanceOutcome): AttendanceEventResult {
    if (outcome.granted) return outcome.result;

    const reason = outcome.reason;
    const body = {
      message: attendanceDenialMessage(reason),
      reason,
      attendance_event_id: outcome.eventId,
      access_decision_id: outcome.decisionId,
    };

    if (
      reason === ATTENDANCE_DECISION_REASONS.ALREADY_CHECKED_IN ||
      reason === ATTENDANCE_DECISION_REASONS.NO_OPEN_CHECK_IN
    ) {
      // Attendance state conflict (409), not a membership-ineligibility refusal.
      throw new ConflictException(body);
    }
    throw new ForbiddenException(body);
  }

  /** Persist the raw attendance event on the caller's transaction. */
  private async createEvent(
    manager: EntityManager,
    input: AttendanceEventInput,
    eventType: string,
  ): Promise<AttendanceEvent> {
    const eventRepository = manager.getRepository(AttendanceEvent);
    return eventRepository.save(
      eventRepository.create({
        organization_id: input.organizationId,
        branch_id: input.branchId ?? null,
        // Manual front-desk event: no turnstile/reader is involved. The Phase 2
        // edge sync will populate these without a schema change.
        device_id: null,
        member_id: input.memberId,
        event_time: input.eventTime,
        event_type: eventType,
        biometric_id: null,
      }),
    );
  }

  /** Persist the authorization outcome of the event. */
  private async saveDecision(
    manager: EntityManager,
    attendanceEventId: string,
    isGranted: boolean,
    reason: string | null,
  ): Promise<AttendanceAccessDecision> {
    const decisionRepository = manager.getRepository(AttendanceAccessDecision);
    return decisionRepository.save(
      decisionRepository.create({
        attendance_event_id: attendanceEventId,
        is_granted: isGranted,
        reason,
      }),
    );
  }

  /** The member's currently open session, locked for update if one exists. */
  private async findOpenRecord(
    manager: EntityManager,
    input: AttendanceEventInput,
  ): Promise<AttendanceRecord | null> {
    return manager.getRepository(AttendanceRecord).findOne({
      where: {
        member_id: input.memberId,
        organization_id: input.organizationId,
        check_out_time: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Publish `AttendanceEventRecorded.v1` on the caller's transaction. */
  private async emitEventRecorded(
    manager: EntityManager,
    input: AttendanceEventInput,
    record: AttendanceRecord,
    eventType: string,
    event: AttendanceEvent,
  ): Promise<void> {
    const payload: AttendanceEventRecordedPayloadShape = {
      eventId: event.id, // the recorded attendance event (docs/event-contracts.md)
      deviceId: null,
      memberId: input.memberId,
      eventTime: input.eventTime.toISOString(),
      eventType,
      biometricId: null,
      checkedInBy: input.userId ?? null,
      ...(eventType === ATTENDANCE_EVENT_KINDS.CHECK_IN
        ? { checkInMethod: ATTENDANCE_METHODS.MANUAL }
        : { checkOutMethod: ATTENDANCE_METHODS.MANUAL }),
    };

    await this.outboxService.saveEventEnvelope(
      ATTENDANCE_EVENT_TYPES.ATTENDANCE_EVENT_RECORDED,
      ATTENDANCE_EVENT_VERSION,
      input.organizationId,
      payload,
      record.id, // correlationId = attendance record id (the session the event belongs to)
      undefined, // causationId: not used for this event
      manager,   // transaction-scoped: atomic with the event/record/decision rows
    );
  }
}
