import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, QueryDeepPartialEntity, Repository } from 'typeorm';
import { PTSession } from '../entities/pt-session.entity';
import { PTEnrollment } from '../entities/pt-enrollment.entity';
import { PersonalTrainer } from '../entities/personal-trainer.entity';
import { PTSessionStatus } from '../entities/pt-session-status.enum';
import { PTEnrollmentStatus } from '../entities/pt-enrollment-status.enum';
import { BookPtSessionDto } from '../dto/book-pt-session.dto';
import { CompletePtSessionDto } from '../dto/complete-pt-session.dto';
import { LinkWorkoutSessionDto } from '../dto/link-workout-session.dto';
import { ListPtSessionsDto } from '../dto/list-pt-sessions.dto';
import { PT_EVENT_TYPES, PT_EVENT_VERSION } from '../pt.constants';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

/**
 * Single legal write path for `PTSession` rows, and the ONLY place
 * `PTEnrollment.sessions_used` is ever incremented.
 *
 * - **Q1**: `completeSession()` atomically increments `sessions_used` and, when
 *   `sessions_used` reaches `session_count`, transitions the enrollment to
 *   `completed` — both in the SAME transaction as the session status write.
 * - **Q3**: nothing here touches attendance. This module imports no attendance
 *   service and writes no attendance table; gym check-ins remain the exclusive
 *   concern of the attendance module.
 * - **Q27**: `workout_session_id` is set only by the explicit
 *   `linkWorkoutSession()` operation — never on booking and never on completion.
 */
@Injectable()
export class PtSessionsService {
  constructor(
    @InjectRepository(PTSession)
    private readonly sessionRepository: Repository<PTSession>,
    @InjectRepository(PTEnrollment)
    private readonly enrollmentRepository: Repository<PTEnrollment>,
    @InjectRepository(PersonalTrainer)
    private readonly trainerRepository: Repository<PersonalTrainer>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId =
      await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId =
      await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new NotFoundException('Organization context not found');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /**
   * The exhaustion guard (Q1): a session can never be booked or completed
   * against a `completed` enrollment, nor against an enrollment whose
   * `sessions_used` already reached `session_count`.
   *
   * Called both before booking and inside the completion transaction (after the
   * enrollment row has been locked), so a concurrent completion cannot overrun
   * the purchased session count.
   */
  private assertEnrollmentHasRemainingSessions(
    enrollment: PTEnrollment,
  ): void {
    if (enrollment.status === PTEnrollmentStatus.COMPLETED) {
      throw new ConflictException(
        'PTEnrollment is completed — no sessions remain',
      );
    }
    if (enrollment.status === PTEnrollmentStatus.CANCELLED) {
      throw new ConflictException('PTEnrollment is cancelled');
    }
    if (enrollment.sessions_used >= enrollment.session_count) {
      throw new ConflictException('PTEnrollment has no remaining sessions');
    }
  }

  /**
   * Book a PT session (status `scheduled`).
   *
   * Rejects an exhausted or `completed` enrollment up front (Q1) and publishes
   * `PTSessionBooked.v1` inside the booking transaction.
   *
   * The session's `member_id` is COPIED from the enrollment — never taken from the
   * request — so a caller cannot book a session for an unrelated member.
   * `workout_session_id` stays NULL: linking a logged workout is manual (Q27).
   */
  async book(dto: BookPtSessionDto): Promise<PTSession> {
    const organizationId = await this.getOrganizationId();

    const enrollment = await this.enrollmentRepository.findOne({
      where: { id: dto.enrollment_id, organization_id: organizationId },
    });
    if (!enrollment) {
      throw new NotFoundException('PTEnrollment not found');
    }
    this.assertEnrollmentHasRemainingSessions(enrollment);

    // Defaults to the enrollment's trainer; an explicit trainer_id supports a
    // substitute trainer leading one specific session.
    const trainer = await this.trainerRepository.findOne({
      where: {
        id: dto.trainer_id ?? enrollment.trainer_id,
        organization_id: organizationId,
      },
    });
    if (!trainer) {
      throw new NotFoundException('PersonalTrainer not found');
    }
    if (!trainer.is_active) {
      throw new BadRequestException('PersonalTrainer is not active');
    }

    if (dto.branch_id) {
      const branchOk = await this.tenantContextService.validateBranchAccess(
        organizationId,
        dto.branch_id,
      );
      if (!branchOk) {
        throw new BadRequestException(
          'Branch does not belong to the authorized organization',
        );
      }
    }

    const scheduledStart = new Date(dto.scheduled_start);
    const scheduledEnd = new Date(dto.scheduled_end);
    if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
      throw new BadRequestException(
        'scheduled_end must be after scheduled_start',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(PTSession);

      const session = sessionRepo.create({
        organization_id: organizationId,
        branch_id: dto.branch_id ?? trainer.branch_id,
        member_id: enrollment.member_id,
        trainer_id: trainer.id,
        enrollment_id: enrollment.id,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        status: PTSessionStatus.SCHEDULED,
        notes: dto.notes ?? null,
        workout_session_id: null,
      });
      const saved = await sessionRepo.save(session);

      await this.outboxService.saveEventEnvelope(
        PT_EVENT_TYPES.SESSION_BOOKED,
        PT_EVENT_VERSION,
        organizationId,
        {
          sessionId: saved.id,
          enrollmentId: saved.enrollment_id,
          memberId: saved.member_id,
          trainerId: saved.trainer_id,
          scheduledStart: saved.scheduled_start.toISOString(),
          scheduledEnd: saved.scheduled_end.toISOString(),
        },
        saved.id,
        undefined,
        manager,
      );

      return saved;
    });
  }

  /**
   * Complete a PT session — the Q1 auto-increment path.
   *
   * In ONE transaction:
   *   1. Lock + re-validate the session (a completed session cannot be completed
   *      twice; only a `scheduled` session can be completed).
   *   2. Lock + re-validate the enrollment (the Q1 exhaustion guard, evaluated
   *      under the lock so concurrent completions cannot overrun the package).
   *   3. Increment `sessions_used` with a SQL-level `sessions_used + 1` expression
   *      (never a stale read-modify-write) and, when the new value reaches
   *      `session_count`, set the enrollment status to `completed` in the SAME
   *      transaction.
   *   4. Mark the session `completed` and publish `PTSessionCompleted.v1`.
   *
   * **No attendance write (Q3)** and no `workout_session_id` change (Q27) — the
   * optional workout link is only ever set by `linkWorkoutSession()`.
   */
  async completeSession(
    sessionId: string,
    dto: CompletePtSessionDto,
  ): Promise<PTSession> {
    const organizationId = await this.getOrganizationId();

    return this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(PTSession);
      const enrollmentRepo = manager.getRepository(PTEnrollment);

      const session = await sessionRepo.findOne({
        where: { id: sessionId, organization_id: organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) {
        throw new NotFoundException('PTSession not found');
      }
      if (session.status === PTSessionStatus.COMPLETED) {
        throw new ConflictException('PT session is already completed');
      }
      if (session.status !== PTSessionStatus.SCHEDULED) {
        throw new ConflictException(
          `A "${session.status}" PT session cannot be completed`,
        );
      }

      const enrollment = await enrollmentRepo.findOne({
        where: { id: session.enrollment_id, organization_id: organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!enrollment) {
        throw new NotFoundException('PTEnrollment not found');
      }
      this.assertEnrollmentHasRemainingSessions(enrollment);

      const sessionsUsedAfter = enrollment.sessions_used + 1;
      const exhausted = sessionsUsedAfter >= enrollment.session_count;

      const enrollmentUpdates: QueryDeepPartialEntity<PTEnrollment> = {
        // Atomic SQL increment (§12 Q1): two concurrent completions can never both
        // read the same pre-increment value.
        sessions_used: () => 'sessions_used + 1',
      };
      if (exhausted) {
        enrollmentUpdates.status = PTEnrollmentStatus.COMPLETED;
      }
      await enrollmentRepo.update(
        { id: enrollment.id, organization_id: organizationId },
        enrollmentUpdates,
      );

      const actualStart = dto.actual_start
        ? new Date(dto.actual_start)
        : new Date();
      const actualEnd = dto.actual_end ? new Date(dto.actual_end) : actualStart;

      session.status = PTSessionStatus.COMPLETED;
      session.actual_start = actualStart;
      session.actual_end = actualEnd;
      if (dto.notes !== undefined) {
        session.notes = dto.notes;
      }
      const saved = await sessionRepo.save(session);

      await this.outboxService.saveEventEnvelope(
        PT_EVENT_TYPES.SESSION_COMPLETED,
        PT_EVENT_VERSION,
        organizationId,
        {
          sessionId: saved.id,
          enrollmentId: saved.enrollment_id,
          actualStart: actualStart.toISOString(),
          actualEnd: actualEnd.toISOString(),
        },
        saved.id,
        undefined,
        manager,
      );

      return saved;
    });
  }

  /**
   * Manually link a PT session to an already-logged `WorkoutSession` (Q27).
   *
   * This is the ONLY place `PTSession.workout_session_id` is ever written. The PT
   * module does not create `WorkoutSession` rows and never populates this link
   * automatically — on booking or on completion.
   *
   * The referenced session is not fetched through `WorkoutsService`: Workouts
   * exports no session read method for Phase 2, so referential integrity is
   * enforced by the `PT_PT_SESSIONS.workout_session_id` foreign key instead
   * (flagged in the module report).
   */
  async linkWorkoutSession(
    sessionId: string,
    dto: LinkWorkoutSessionDto,
  ): Promise<PTSession> {
    const organizationId = await this.getOrganizationId();

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, organization_id: organizationId },
    });
    if (!session) {
      throw new NotFoundException('PTSession not found');
    }

    await this.sessionRepository.update(
      { id: sessionId, organization_id: organizationId },
      { workout_session_id: dto.workout_session_id },
    );

    return this.findOne(sessionId);
  }

  async findAll(query: ListPtSessionsDto): Promise<PTSession[]> {
    const organizationId = await this.getOrganizationId();
    const where: FindOptionsWhere<PTSession> = {
      organization_id: organizationId,
    };
    if (query.enrollment_id) where.enrollment_id = query.enrollment_id;
    if (query.trainer_id) where.trainer_id = query.trainer_id;
    if (query.member_id) where.member_id = query.member_id;
    if (query.status) where.status = query.status;

    return this.sessionRepository.find({
      where,
      order: { scheduled_start: 'DESC' },
    });
  }

  async findOne(id: string): Promise<PTSession> {
    const organizationId = await this.getOrganizationId();
    const session = await this.sessionRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!session) {
      throw new NotFoundException('PTSession not found');
    }
    return session;
  }
}