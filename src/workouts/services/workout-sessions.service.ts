import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { WorkoutSession } from '../entities/workout-session.entity';
import { WorkoutSessionExercise } from '../entities/workout-session-exercise.entity';
import { WorkoutSessionStatus } from '../entities/workout-session-status.enum';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { Exercise } from '../entities/exercise.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { PrescribedWorkoutDay } from '../entities/prescribed-workout-day.entity';
import { PrescribedWorkoutDayExercise } from '../entities/prescribed-workout-day-exercise.entity';
import { PlanDaySubmission } from '../entities/plan-day-submission.entity';
import { PlanDaySubmissionExercise } from '../entities/plan-day-submission-exercise.entity';
import { PlanDayStatus } from '../entities/plan-day-status.enum';
import { AssignmentStatus } from '../entities/assignment-status.enum';
import { AssignmentLoggingMode } from '../entities/assignment-logging-mode.enum';
import {
  CreateWorkoutSessionDto,
  SessionExerciseInputDto,
} from '../dto/create-workout-session.dto';
import { UpdateWorkoutSessionDto } from '../dto/update-workout-session.dto';
import { SubmitPlanDayDto } from '../dto/submit-plan-day.dto';
import { ListWorkoutSessionsDto } from '../dto/list-workout-sessions.dto';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  WORKOUT_EVENT_TYPES,
  WORKOUT_EVENT_VERSION,
} from '../workouts.constants';

export interface PlanDaySubmissionDetail extends PlanDaySubmission {
  exercises: PlanDaySubmissionExercise[];
}

/**
 * Member workout-session lifecycle and plan-day submission.
 *
 * Session status and prescribed-day status are separate:
 *   - creating/finishing a session never approves a plan day;
 *   - cancelling a session never expires or discards the pending day;
 *   - several sessions may contribute to one prescribed day.
 */
@Injectable()
export class WorkoutSessionsService {
  constructor(
    @InjectRepository(WorkoutSession)
    private readonly sessionRepository: Repository<WorkoutSession>,
    @InjectRepository(WorkoutSessionExercise)
    private readonly sessionExerciseRepository: Repository<WorkoutSessionExercise>,
    @InjectRepository(WorkoutTemplate)
    private readonly legacyTemplateRepository: Repository<WorkoutTemplate>,
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>,
    @InjectRepository(WorkoutPlanAssignment)
    private readonly assignmentRepository: Repository<WorkoutPlanAssignment>,
    @InjectRepository(PrescribedWorkoutDay)
    private readonly prescribedDayRepository: Repository<PrescribedWorkoutDay>,
    @InjectRepository(PrescribedWorkoutDayExercise)
    private readonly prescribedExerciseRepository: Repository<PrescribedWorkoutDayExercise>,
    @InjectRepository(PlanDaySubmission)
    private readonly submissionRepository: Repository<PlanDaySubmission>,
    @InjectRepository(PlanDaySubmissionExercise)
    private readonly submissionExerciseRepository: Repository<PlanDaySubmissionExercise>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenant: WorkoutsTenantService,
    private readonly outboxService: OutboxService,
  ) {}

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  async create(
    organizationId: string,
    memberId: string,
    dto: CreateWorkoutSessionDto,
    submittedBy: string,
  ): Promise<WorkoutSession> {
    await this.tenant.requireMemberInOrganization(memberId, organizationId);

    const { assignment, day } = await this.resolveSessionContext(
      organizationId,
      memberId,
      dto.assignment_id,
      dto.prescribed_day_id,
    );

    if (dto.template_id) {
      const template = await this.legacyTemplateRepository.findOne({
        where: { id: dto.template_id, organization_id: organizationId },
      });
      if (!template) {
        throw new NotFoundException('Workout template not found');
      }
    }

    await this.validateExerciseInputs(
      organizationId,
      day?.id ?? null,
      assignment,
      dto.exercises ?? [],
    );

    const session = await this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(WorkoutSession);
      const created = await sessionRepo.save(
        sessionRepo.create({
          organization_id: organizationId,
          member_id: memberId,
          template_id: dto.template_id ?? null,
          assignment_id: assignment?.id ?? null,
          prescribed_day_id: day?.id ?? null,
          session_date: this.normaliseDate(dto.session_date),
          created_by: submittedBy,
          started_at: new Date(),
          duration_minutes: dto.duration_minutes ?? null,
          notes: dto.notes ?? null,
          mood: dto.mood ?? null,
          status: WorkoutSessionStatus.IN_PROGRESS,
        }),
      );

      const exercises = await this.replaceSessionExercises(
        manager,
        created.id,
        dto.exercises ?? [],
      );

      await this.outboxService.saveEventEnvelope(
        WORKOUT_EVENT_TYPES.WORKOUT_SESSION_LOGGED,
        WORKOUT_EVENT_VERSION,
        organizationId,
        {
          sessionId: created.id,
          memberId,
          organizationId,
          templateId: created.template_id ?? null,
          assignmentId: created.assignment_id ?? null,
          prescribedDayId: created.prescribed_day_id ?? null,
          sessionDate: created.session_date,
          startedAt: created.started_at?.toISOString() ?? null,
          completedAt: null,
          durationMinutes: created.duration_minutes ?? null,
        },
        memberId,
        undefined,
        manager,
      );

      created.session_exercises = exercises;
      return created;
    });

    return session;
  }

  async update(
    organizationId: string,
    sessionId: string,
    dto: UpdateWorkoutSessionDto,
  ): Promise<WorkoutSession> {
    const session = await this.getSession(organizationId, sessionId);
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new ConflictException(
        'Only an in-progress session can be edited',
      );
    }

    let assignment: WorkoutPlanAssignment | null = null;
    let day: PrescribedWorkoutDay | null = null;
    if (session.prescribed_day_id) {
      day = await this.prescribedDayRepository.findOne({
        where: {
          id: session.prescribed_day_id,
          organization_id: organizationId,
        },
      });
      if (day) {
        assignment = await this.assignmentRepository.findOne({
          where: {
            id: day.assignment_id,
            organization_id: organizationId,
            member_id: session.member_id,
          },
        });
      }
    }

    if (dto.exercises) {
      await this.validateExerciseInputs(
        organizationId,
        day?.id ?? null,
        assignment,
        dto.exercises,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(WorkoutSession);
      const patch: Partial<WorkoutSession> = {};
      if (dto.notes !== undefined) patch.notes = dto.notes;
      if (dto.mood !== undefined) patch.mood = dto.mood;
      if (dto.duration_minutes !== undefined) {
        patch.duration_minutes = dto.duration_minutes;
      }
      if (Object.keys(patch).length > 0) {
        await sessionRepo.update(
          { id: session.id, organization_id: organizationId },
          patch,
        );
      }
      if (dto.exercises) {
        await this.replaceSessionExercises(
          manager,
          session.id,
          dto.exercises,
        );
      }
    });

    return this.getSession(organizationId, sessionId);
  }

  async finish(
    organizationId: string,
    sessionId: string,
  ): Promise<WorkoutSession> {
    const session = await this.getSession(organizationId, sessionId);
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new ConflictException(
        'Only an in-progress session can be finished',
      );
    }
    await this.sessionRepository.update(
      { id: session.id, organization_id: organizationId },
      {
        status: WorkoutSessionStatus.FINISHED,
        completed_at: new Date(),
      },
    );
    return this.getSession(organizationId, sessionId);
  }

  async cancel(
    organizationId: string,
    sessionId: string,
  ): Promise<WorkoutSession> {
    const session = await this.getSession(organizationId, sessionId);
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new ConflictException(
        'Only an in-progress session can be cancelled',
      );
    }
    await this.sessionRepository.update(
      { id: session.id, organization_id: organizationId },
      {
        status: WorkoutSessionStatus.CANCELLED,
        cancelled_at: new Date(),
      },
    );
    return this.getSession(organizationId, sessionId);
  }

  /**
   * Trainer soft deletion.
   *
   * No reason is required. The row is retained and only marked with
   * `deleted_at`/`deleted_by`; ordinary member history excludes it. Plan-day
   * status and submission snapshots are deliberately untouched.
   */
  async softDelete(
    organizationId: string,
    sessionId: string,
    deletedBy: string,
  ): Promise<{ success: true; id: string; deleted_at: Date | null }> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, organization_id: organizationId },
    });
    if (!session) {
      throw new NotFoundException('Workout session not found');
    }
    if (session.deleted_at) {
      return { success: true, id: session.id, deleted_at: session.deleted_at };
    }
    const deletedAt = new Date();
    await this.sessionRepository.update(
      { id: session.id, organization_id: organizationId },
      { deleted_at: deletedAt, deleted_by: deletedBy },
    );
    return { success: true, id: session.id, deleted_at: deletedAt };
  }

  async getSession(
    organizationId: string,
    sessionId: string,
    includeDeleted = false,
  ): Promise<WorkoutSession> {
    const session = await this.sessionRepository.findOne({
      where: {
        id: sessionId,
        organization_id: organizationId,
        ...(includeDeleted ? {} : { deleted_at: IsNull() }),
      },
      relations: ['session_exercises'],
    });
    if (!session) {
      throw new NotFoundException('Workout session not found');
    }
    return session;
  }

  async listMemberSessions(
    organizationId: string,
    memberId: string,
    query: ListWorkoutSessionsDto = {},
  ): Promise<WorkoutSession[]> {
    await this.tenant.requireMemberInOrganization(memberId, organizationId);

    const where: FindOptionsWhere<WorkoutSession> = {
      organization_id: organizationId,
      member_id: memberId,
    };
    if (!query.include_deleted) {
      where.deleted_at = IsNull();
    }
    if (query.prescribed_day_id) {
      where.prescribed_day_id = query.prescribed_day_id;
    }
    if (query.assignment_id) {
      where.assignment_id = query.assignment_id;
    }

    return this.sessionRepository.find({
      where,
      relations: ['session_exercises'],
      order: { session_date: 'DESC', created_at: 'DESC' },
    });
  }

  async listPrescribedDaySessions(
    organizationId: string,
    dayId: string,
  ): Promise<WorkoutSession[]> {
    const day = await this.prescribedDayRepository.findOne({
      where: { id: dayId, organization_id: organizationId },
    });
    if (!day) {
      throw new NotFoundException('Prescribed workout day not found');
    }
    return this.sessionRepository.find({
      where: {
        organization_id: organizationId,
        prescribed_day_id: day.id,
        deleted_at: IsNull(),
      },
      relations: ['session_exercises'],
      order: { session_date: 'ASC', created_at: 'ASC' },
    });
  }

  // ---------------------------------------------------------------------------
  // Member submission of a prescribed day
  // ---------------------------------------------------------------------------

  /**
   * Submit the prescribed day for trainer review.
   *
   * The exercise report is derived from the member's FINISHED sessions linked to
   * the day — the client cannot supply arbitrary completion values. A new
   * immutable submission row is created on every call; earlier submissions are
   * never overwritten. The day moves to `submitted`; only a trainer can approve
   * it.
   */
  async submitDay(
    organizationId: string,
    dayId: string,
    dto: SubmitPlanDayDto,
    submittedBy: string,
  ): Promise<PlanDaySubmissionDetail> {
    const day = await this.prescribedDayRepository.findOne({
      where: { id: dayId, organization_id: organizationId },
    });
    if (!day) {
      throw new NotFoundException('Prescribed workout day not found');
    }
    if (day.is_rest_day) {
      throw new BadRequestException('A rest day cannot be submitted');
    }
    if (day.status === PlanDayStatus.APPROVED) {
      throw new ConflictException('This prescribed day is already approved');
    }

    const assignment = await this.assignmentRepository.findOne({
      where: {
        id: day.assignment_id,
        organization_id: organizationId,
      },
    });
    if (!assignment) {
      throw new NotFoundException('Workout plan assignment not found');
    }

    const sessions = await this.sessionRepository.find({
      where: {
        organization_id: organizationId,
        prescribed_day_id: day.id,
        member_id: assignment.member_id,
        status: WorkoutSessionStatus.FINISHED,
        deleted_at: IsNull(),
      },
      order: { completed_at: 'ASC', created_at: 'ASC' },
    });
    if (sessions.length === 0) {
      throw new BadRequestException(
        'No finished session is linked to this prescribed day',
      );
    }

    const sessionExercises = await this.sessionExerciseRepository.find({
      where: { session_id: In(sessions.map((session) => session.id)) },
      order: { created_at: 'ASC' },
    });
    const prescribedExercises = await this.prescribedExerciseRepository.find({
      where: { prescribed_day_id: day.id },
      order: { sort_order: 'ASC' },
    });

    const reports = this.buildReports(
      prescribedExercises,
      sessionExercises,
      assignment.logging_mode,
    );

    return this.dataSource.transaction(async (manager) => {
      const submissionRepo = manager.getRepository(PlanDaySubmission);
      const reportRepo = manager.getRepository(PlanDaySubmissionExercise);
      const dayRepo = manager.getRepository(PrescribedWorkoutDay);

      const submittedAt = new Date();
      const submission = await submissionRepo.save(
        submissionRepo.create({
          organization_id: organizationId,
          prescribed_day_id: day.id,
          member_id: assignment.member_id,
          submitted_by: submittedBy,
          submitted_at: submittedAt,
          notes: dto.notes ?? null,
        }),
      );

      const exerciseRows =
        reports.length > 0
          ? await reportRepo.save(
              reports.map((report) =>
                reportRepo.create({
                  submission_id: submission.id,
                  prescribed_day_exercise_id:
                    report.prescribed_day_exercise_id,
                  completed: report.completed,
                  sets_completed: report.sets_completed,
                  reps_completed: report.reps_completed,
                  weight_used: report.weight_used,
                  notes: report.notes,
                }),
              ),
            )
          : [];

      await dayRepo.update(
        { id: day.id, organization_id: organizationId },
        {
          status: PlanDayStatus.SUBMITTED,
          submitted_at: submittedAt,
        },
      );

      await this.outboxService.saveEventEnvelope(
        WORKOUT_EVENT_TYPES.WORKOUT_PLAN_DAY_SUBMITTED,
        WORKOUT_EVENT_VERSION,
        organizationId,
        {
          prescribedDayId: day.id,
          assignmentId: assignment.id,
          memberId: assignment.member_id,
          submissionId: submission.id,
          submittedAt: submittedAt.toISOString(),
          sessionIds: sessions.map((session) => session.id),
        },
        assignment.member_id,
        undefined,
        manager,
      );

      return { ...submission, exercises: exerciseRows };
    });
  }

  async listDaySubmissions(
    organizationId: string,
    dayId: string,
  ): Promise<PlanDaySubmissionDetail[]> {
    const day = await this.prescribedDayRepository.findOne({
      where: { id: dayId, organization_id: organizationId },
    });
    if (!day) {
      throw new NotFoundException('Prescribed workout day not found');
    }
    const submissions = await this.submissionRepository.find({
      where: { organization_id: organizationId, prescribed_day_id: day.id },
      order: { submitted_at: 'DESC' },
    });
    if (submissions.length === 0) {
      return [];
    }
    const exercises = await this.submissionExerciseRepository.find({
      where: { submission_id: In(submissions.map((s) => s.id)) },
      order: { created_at: 'ASC' },
    });
    const bySubmission = new Map<string, PlanDaySubmissionExercise[]>();
    for (const exercise of exercises) {
      const rows = bySubmission.get(exercise.submission_id) ?? [];
      rows.push(exercise);
      bySubmission.set(exercise.submission_id, rows);
    }
    return submissions.map((submission) => ({
      ...submission,
      exercises: bySubmission.get(submission.id) ?? [],
    }));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveSessionContext(
    organizationId: string,
    memberId: string,
    assignmentId: string | undefined,
    prescribedDayId: string | undefined,
  ): Promise<{
    assignment: WorkoutPlanAssignment | null;
    day: PrescribedWorkoutDay | null;
  }> {
    if (prescribedDayId) {
      const day = await this.prescribedDayRepository.findOne({
        where: { id: prescribedDayId, organization_id: organizationId },
      });
      if (!day) {
        throw new NotFoundException('Prescribed workout day not found');
      }
      if (day.is_rest_day) {
        throw new BadRequestException(
          'A rest day has no workout to start a session for',
        );
      }
      if (assignmentId && assignmentId !== day.assignment_id) {
        throw new BadRequestException(
          'The prescribed day does not belong to the given assignment',
        );
      }
      const assignment = await this.assignmentRepository.findOne({
        where: {
          id: day.assignment_id,
          organization_id: organizationId,
          member_id: memberId,
        },
      });
      if (!assignment) {
        throw new NotFoundException('Workout plan assignment not found');
      }
      if (assignment.status !== AssignmentStatus.ACTIVE) {
        throw new ConflictException('Workout plan assignment is not active');
      }
      return { assignment, day };
    }

    if (assignmentId) {
      const assignment = await this.assignmentRepository.findOne({
        where: {
          id: assignmentId,
          organization_id: organizationId,
          member_id: memberId,
        },
      });
      if (!assignment) {
        throw new NotFoundException('Workout plan assignment not found');
      }
      if (assignment.status !== AssignmentStatus.ACTIVE) {
        throw new ConflictException('Workout plan assignment is not active');
      }
      return { assignment, day: null };
    }

    return { assignment: null, day: null };
  }

  private async validateExerciseInputs(
    organizationId: string,
    dayId: string | null,
    assignment: WorkoutPlanAssignment | null,
    inputs: SessionExerciseInputDto[],
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    const keys = inputs.map(
      (input) => input.prescribed_day_exercise_id ?? input.exercise_id,
    );
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException(
        'Each exercise may appear only once in a session log',
      );
    }

    const exerciseIds = [...new Set(inputs.map((input) => input.exercise_id))];
    const exercises = await this.exerciseRepository.find({
      where: { id: In(exerciseIds), organization_id: organizationId },
    });
    if (exercises.length !== exerciseIds.length) {
      throw new BadRequestException(
        'One or more exercises do not exist in this organization',
      );
    }

    let prescribed: PrescribedWorkoutDayExercise[] = [];
    if (dayId) {
      prescribed = await this.prescribedExerciseRepository.find({
        where: { prescribed_day_id: dayId },
      });
    }
    const prescribedById = new Map(prescribed.map((row) => [row.id, row]));
    const prescribedByExercise = new Map(
      prescribed.map((row) => [row.exercise_id, row]),
    );

    for (const input of inputs) {
      if (dayId) {
        if (input.prescribed_day_exercise_id) {
          if (!prescribedById.has(input.prescribed_day_exercise_id)) {
            throw new BadRequestException(
              'The prescribed exercise does not belong to this day',
            );
          }
        } else if (!prescribedByExercise.has(input.exercise_id)) {
          throw new BadRequestException(
            'The exercise is not prescribed for this day',
          );
        }
      }

      if (!dayId || !assignment) {
        continue;
      }

      if (assignment.logging_mode === AssignmentLoggingMode.SIMPLE) {
        if (typeof input.completed !== 'boolean') {
          throw new BadRequestException(
            'A simple logging plan requires completed=true/false for each exercise',
          );
        }
      } else {
        if (
          input.sets_completed === undefined ||
          input.reps_completed === undefined
        ) {
          throw new BadRequestException(
            'A detailed logging plan requires sets_completed and reps_completed',
          );
        }
      }
    }
  }

  private async replaceSessionExercises(
    manager: EntityManager,
    sessionId: string,
    inputs: SessionExerciseInputDto[],
  ): Promise<WorkoutSessionExercise[]> {
    const repo = manager.getRepository(WorkoutSessionExercise);
    await repo.delete({ session_id: sessionId });
    if (inputs.length === 0) {
      return [];
    }
    return repo.save(
      inputs.map((input) =>
        repo.create({
          session_id: sessionId,
          exercise_id: input.exercise_id,
          prescribed_day_exercise_id:
            input.prescribed_day_exercise_id ?? null,
          completed: input.completed ?? null,
          sets_completed: input.sets_completed ?? null,
          reps_completed: input.reps_completed ?? null,
          weight_used: input.weight_used ?? null,
          rpe: input.rpe ?? null,
          notes: input.notes ?? null,
        }),
      ),
    );
  }

  /**
   * Build the immutable per-exercise report for a day submission.
   *
   * The latest log per prescribed exercise wins for actuals; `completed` is true
   * if any contributing session marked it complete. A detailed (PT) plan treats
   * a positive set count as completion when the member did not tick a checkbox.
   */
  private buildReports(
    prescribedExercises: PrescribedWorkoutDayExercise[],
    sessionExercises: WorkoutSessionExercise[],
    loggingMode: AssignmentLoggingMode,
  ): Array<{
    prescribed_day_exercise_id: string;
    completed: boolean;
    sets_completed: number | null;
    reps_completed: number | null;
    weight_used: number | null;
    notes: string | null;
  }> {
    return prescribedExercises.map((prescribed) => {
      const rows = sessionExercises.filter(
        (row) =>
          row.prescribed_day_exercise_id === prescribed.id ||
          (!row.prescribed_day_exercise_id &&
            row.exercise_id === prescribed.exercise_id),
      );
      const latest = rows.length > 0 ? rows[rows.length - 1] : null;
      const explicitlyCompleted = rows.some((row) => row.completed === true);
      const detailedCompletion =
        loggingMode === AssignmentLoggingMode.DETAILED &&
        latest?.sets_completed != null &&
        latest.sets_completed > 0;

      return {
        prescribed_day_exercise_id: prescribed.id,
        completed: explicitlyCompleted || detailedCompletion,
        sets_completed: latest?.sets_completed ?? null,
        reps_completed: latest?.reps_completed ?? null,
        weight_used: latest?.weight_used ?? null,
        notes: latest?.notes ?? null,
      };
    });
  }

  private normaliseDate(value?: string): string {
    return value ? value.slice(0, 10) : new Date().toISOString().slice(0, 10);
  }
}
