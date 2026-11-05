import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { WorkoutPlanTemplate } from '../entities/workout-plan-template.entity';
import { WorkoutPlanTemplateDay } from '../entities/workout-plan-template-day.entity';
import { WorkoutDayTemplate } from '../entities/workout-day-template.entity';
import { WorkoutDayTemplateExercise } from '../entities/workout-day-template-exercise.entity';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { WorkoutTemplateExercise } from '../entities/workout-template-exercise.entity';
import { Exercise } from '../entities/exercise.entity';
import { PrescribedWorkoutDay } from '../entities/prescribed-workout-day.entity';
import { PrescribedWorkoutDayExercise } from '../entities/prescribed-workout-day-exercise.entity';
import { AssignmentStatus } from '../entities/assignment-status.enum';
import { AssignmentLoggingMode } from '../entities/assignment-logging-mode.enum';
import { ExerciseSection } from '../entities/exercise-section.enum';
import { PlanDayStatus } from '../entities/plan-day-status.enum';
import { AssignPlanInput } from '../dto/assign-plan.input';
import { CreateAssignmentDto } from '../dto/create-assignment.dto';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { isUniqueViolation } from '../../shared/utils/unique-violation';
import {
  WORKOUT_EVENT_TYPES,
  WORKOUT_EVENT_VERSION,
} from '../workouts.constants';

/** Primary plan progress plus the supporting exercise-level metric. */
export interface AssignmentProgress {
  /** Trainer-approved finished prescribed days (the numerator). */
  completed: number;
  /** Non-rest prescribed days (the denominator). */
  prescribed: number;
  /** completed / prescribed, rounded, never above 100. */
  percentage: number;
  status_counts: {
    pending: number;
    submitted: number;
    remaining_required: number;
    approved: number;
  };
  /** Supporting metric only — never the primary plan-completion measure. */
  exercise_completion: {
    completed: number;
    prescribed: number;
    percentage: number;
  };
}

export interface PrescribedDayWithExercises extends PrescribedWorkoutDay {
  exercises: PrescribedWorkoutDayExercise[];
}

export interface AssignmentDetail {
  assignment: WorkoutPlanAssignment;
  days: PrescribedDayWithExercises[];
  progress: AssignmentProgress;
}

export interface SequenceEntry {
  assignment: WorkoutPlanAssignment;
  days: PrescribedWorkoutDay[];
  current_day_id: string | null;
  progress: AssignmentProgress;
}

interface PlanDaySourceExercise {
  exercise_id: string;
  exercise_name: string;
  section: ExerciseSection;
  sets?: number | null;
  reps?: number | null;
  weight_template?: number | null;
  rest_seconds?: number | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  instructions?: string | null;
  sort_order: number;
}

interface PlanDaySource {
  sequence_order: number;
  source_day_template_id: string | null;
  name: string;
  day_label: string | null;
  is_rest_day: boolean;
  is_optional: boolean;
  exercises: PlanDaySourceExercise[];
}

interface AssignmentSource {
  planTemplateId: string | null;
  templateId: string | null;
  loggingMode: AssignmentLoggingMode;
  days: PlanDaySource[];
}

/**
 * The single write path for workout-plan assignment and the owner of the
 * assignment-specific prescribed-day snapshot.
 *
 * Assigning copies the plan's composition into `WORKOUTS_PRESCRIBED_DAYS` /
 * `WORKOUTS_PRESCRIBED_DAY_EXERCISES`. The reusable template is never read
 * again for that assignment, so editing it later changes only future
 * assignments.
 */
@Injectable()
export class WorkoutAssignmentsService {
  constructor(
    @InjectRepository(WorkoutPlanAssignment)
    private readonly assignmentRepository: Repository<WorkoutPlanAssignment>,
    @InjectRepository(WorkoutPlanTemplate)
    private readonly planTemplateRepository: Repository<WorkoutPlanTemplate>,
    @InjectRepository(WorkoutDayTemplate)
    private readonly dayTemplateRepository: Repository<WorkoutDayTemplate>,
    @InjectRepository(WorkoutDayTemplateExercise)
    private readonly dayTemplateExerciseRepository: Repository<WorkoutDayTemplateExercise>,
    @InjectRepository(WorkoutTemplate)
    private readonly legacyTemplateRepository: Repository<WorkoutTemplate>,
    @InjectRepository(WorkoutTemplateExercise)
    private readonly legacyTemplateExerciseRepository: Repository<WorkoutTemplateExercise>,
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>,
    @InjectRepository(PrescribedWorkoutDay)
    private readonly prescribedDayRepository: Repository<PrescribedWorkoutDay>,
    @InjectRepository(PrescribedWorkoutDayExercise)
    private readonly prescribedExerciseRepository: Repository<PrescribedWorkoutDayExercise>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenant: WorkoutsTenantService,
    private readonly outboxService: OutboxService,
  ) {}

  // ---------------------------------------------------------------------------
  // Assignment
  // ---------------------------------------------------------------------------

  /**
   * Assign a reusable weekly plan template to a member.
   *
   * `options.manager` lets the progress-review service create the next
   * assignment in the same transaction as the review, so a review can never
   * reference an assignment that failed to commit.
   */
  async assignPlanTemplate(
    organizationId: string,
    memberId: string,
    dto: CreateAssignmentDto,
    assignedBy: string,
    options: { manager?: EntityManager; progressReviewId?: string } = {},
  ): Promise<WorkoutPlanAssignment> {
    await this.tenant.requireMemberInOrganization(memberId, organizationId);

    const source = await this.buildPlanTemplateSource(
      organizationId,
      dto.plan_template_id,
    );
    source.loggingMode = dto.logging_mode ?? AssignmentLoggingMode.SIMPLE;

    const existing = await this.assignmentRepository.findOne({
      where: {
        organization_id: organizationId,
        member_id: memberId,
        plan_template_id: dto.plan_template_id,
        status: AssignmentStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Member already has an active assignment for this plan template',
      );
    }

    const insert = (manager: EntityManager) =>
      this.insertAssignmentSnapshot(
        manager,
        organizationId,
        memberId,
        source,
        dto.start_date,
        dto.end_date ?? null,
        dto.notes ?? null,
        assignedBy,
        options.progressReviewId,
      );

    return options.manager
      ? insert(options.manager)
      : this.dataSource.transaction(insert);
  }

  /**
   * Legacy flat-template assignment, retained for the PT integration
   * (`PT → WorkoutsService.assignPlan()`).
   *
   * Its snapshot is grouped by the flat template's `day_of_week`, matching the
   * data migration that backfilled existing assignments.
   */
  async assignLegacyPlan(input: AssignPlanInput): Promise<WorkoutPlanAssignment> {
    const organizationId = await this.tenant.getOrganizationId();
    await this.tenant.requireMemberInOrganization(input.memberId, organizationId);

    const template = await this.legacyTemplateRepository.findOne({
      where: { id: input.templateId, organization_id: organizationId },
    });
    if (!template) {
      throw new NotFoundException(
        `WorkoutTemplate "${input.templateId}" not found in organization`,
      );
    }

    const existing = await this.assignmentRepository.findOne({
      where: {
        organization_id: organizationId,
        member_id: input.memberId,
        template_id: input.templateId,
        status: AssignmentStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Member already has an active assignment for this template',
      );
    }

    const source = await this.buildLegacyTemplateSource(
      organizationId,
      template,
      input.loggingMode ?? AssignmentLoggingMode.SIMPLE,
    );

    return this.dataSource.transaction((manager) =>
      this.insertAssignmentSnapshot(
        manager,
        organizationId,
        input.memberId,
        source,
        input.startDate,
        input.endDate ?? null,
        input.notes ?? null,
        input.assignedBy,
        undefined,
      ),
    );
  }

  private async buildPlanTemplateSource(
    organizationId: string,
    planTemplateId: string,
  ): Promise<AssignmentSource> {
    const planTemplate = await this.planTemplateRepository.findOne({
      where: { id: planTemplateId, organization_id: organizationId },
      relations: ['days'],
    });
    if (!planTemplate) {
      throw new NotFoundException('Workout plan template not found');
    }

    const days = [...(planTemplate.days ?? [])].sort(
      (a, b) => a.day_order - b.day_order,
    );
    if (days.length === 0) {
      throw new BadRequestException(
        'Workout plan template has no days to assign',
      );
    }

    const trainingDayIds = [
      ...new Set(
        days
          .filter((day) => !day.is_rest_day)
          .map((day) => day.day_template_id)
          .filter((value): value is string => !!value),
      ),
    ];

    for (const day of days) {
      if (!day.is_rest_day && !day.day_template_id) {
        throw new BadRequestException(
          'Workout plan template contains a training day without a day template',
        );
      }
    }

    const dayTemplates =
      trainingDayIds.length > 0
        ? await this.dayTemplateRepository.find({
            where: {
              id: In(trainingDayIds),
              organization_id: organizationId,
              is_active: true,
            },
          })
        : [];
    if (dayTemplates.length !== trainingDayIds.length) {
      throw new BadRequestException(
        'One or more workout day templates are missing or inactive in this organization',
      );
    }

    const dayTemplateExercises =
      trainingDayIds.length > 0
        ? await this.dayTemplateExerciseRepository.find({
            where: { day_template_id: In(trainingDayIds) },
            order: { sort_order: 'ASC' },
          })
        : [];

    const exerciseIds = [
      ...new Set(dayTemplateExercises.map((row) => row.exercise_id)),
    ];
    const library =
      exerciseIds.length > 0
        ? await this.exerciseRepository.find({
            where: { id: In(exerciseIds), organization_id: organizationId },
          })
        : [];
    if (library.length !== exerciseIds.length) {
      throw new BadRequestException(
        'One or more exercises do not exist in this organization',
      );
    }
    const exerciseNames = new Map(
      library.map((exercise) => [exercise.id, exercise.name]),
    );
    const dayTemplatesById = new Map(
      dayTemplates.map((template) => [template.id, template]),
    );

    const sourceDays: PlanDaySource[] = days.map((day) => {
      if (day.is_rest_day) {
        return {
          sequence_order: day.day_order,
          source_day_template_id: null,
          name: day.day_label ?? 'Rest',
          day_label: day.day_label ?? null,
          is_rest_day: true,
          is_optional: day.is_optional,
          exercises: [],
        };
      }

      const dayTemplate = dayTemplatesById.get(day.day_template_id as string);
      if (!dayTemplate) {
        // Already rejected above; keeps TypeScript honest.
        throw new BadRequestException('Workout day template not found');
      }

      const exercises = dayTemplateExercises
        .filter((row) => row.day_template_id === dayTemplate.id)
        .map((row) => ({
          exercise_id: row.exercise_id,
          exercise_name: exerciseNames.get(row.exercise_id) ?? '',
          section: row.section,
          sets: row.sets ?? null,
          reps: row.reps ?? null,
          weight_template: row.weight_template ?? null,
          rest_seconds: row.rest_seconds ?? null,
          duration_seconds: row.duration_seconds ?? null,
          distance_meters: row.distance_meters ?? null,
          instructions: row.instructions ?? null,
          sort_order: row.sort_order,
        }));

      return {
        sequence_order: day.day_order,
        source_day_template_id: dayTemplate.id,
        name: day.day_label ?? dayTemplate.name,
        day_label: day.day_label ?? null,
        is_rest_day: false,
        is_optional: day.is_optional,
        exercises,
      };
    });

    return {
      planTemplateId: planTemplate.id,
      templateId: null,
      loggingMode: AssignmentLoggingMode.SIMPLE,
      days: sourceDays,
    };
  }

  private async buildLegacyTemplateSource(
    organizationId: string,
    template: WorkoutTemplate,
    loggingMode: AssignmentLoggingMode,
  ): Promise<AssignmentSource> {
    const templateExercises = await this.legacyTemplateExerciseRepository.find({
      where: { template_id: template.id },
      order: { sort_order: 'ASC' },
    });

    const exerciseIds = [
      ...new Set(templateExercises.map((row) => row.exercise_id)),
    ];
    const library =
      exerciseIds.length > 0
        ? await this.exerciseRepository.find({
            where: { id: In(exerciseIds), organization_id: organizationId },
          })
        : [];
    const exerciseNames = new Map(
      library.map((exercise) => [exercise.id, exercise.name]),
    );

    // Group by the flat template's day_of_week, exactly like the backfill
    // migration: `COALESCE(day_of_week, 0) + 1` is the stable sequence order.
    const groups = new Map<number, WorkoutTemplateExercise[]>();
    for (const row of templateExercises) {
      const key = (row.day_of_week ?? 0) + 1;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    const sourceDays: PlanDaySource[] = [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sequenceOrder, rows]) => ({
        sequence_order: sequenceOrder,
        source_day_template_id: null,
        name: `${template.name} - Day ${sequenceOrder}`,
        day_label: null,
        is_rest_day: false,
        is_optional: false,
        exercises: rows.map((row) => ({
          exercise_id: row.exercise_id,
          exercise_name: exerciseNames.get(row.exercise_id) ?? '',
          section: ExerciseSection.STRENGTH,
          sets: row.sets ?? null,
          reps: row.reps ?? null,
          weight_template: row.weight_template ?? null,
          rest_seconds: row.rest_seconds ?? null,
          duration_seconds: null,
          distance_meters: null,
          instructions: null,
          sort_order: row.sort_order,
        })),
      }));

    return {
      planTemplateId: null,
      templateId: template.id,
      loggingMode,
      days: sourceDays,
    };
  }

  private async insertAssignmentSnapshot(
    manager: EntityManager,
    organizationId: string,
    memberId: string,
    source: AssignmentSource,
    startDate: string,
    endDate: string | null,
    notes: string | null,
    assignedBy: string,
    progressReviewId?: string,
  ): Promise<WorkoutPlanAssignment> {
    const assignmentRepo = manager.getRepository(WorkoutPlanAssignment);
    const dayRepo = manager.getRepository(PrescribedWorkoutDay);
    const exerciseRepo = manager.getRepository(PrescribedWorkoutDayExercise);

    const assignment = assignmentRepo.create({
      organization_id: organizationId,
      member_id: memberId,
      template_id: source.templateId,
      plan_template_id: source.planTemplateId,
      assigned_by: assignedBy,
      assigned_at: new Date(),
      start_date: startDate,
      end_date: endDate,
      notes,
      status: AssignmentStatus.ACTIVE,
      logging_mode: source.loggingMode,
      snapshot_taken_at: new Date(),
      progress_review_id: progressReviewId ?? null,
    });

    let saved: WorkoutPlanAssignment;
    try {
      saved = await assignmentRepo.save(assignment);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Member already has an active assignment for this plan',
        );
      }
      throw error;
    }

    for (const daySource of source.days) {
      const day = await dayRepo.save(
        dayRepo.create({
          organization_id: organizationId,
          assignment_id: saved.id,
          sequence_order: daySource.sequence_order,
          source_day_template_id: daySource.source_day_template_id,
          name: daySource.name,
          day_label: daySource.day_label,
          is_rest_day: daySource.is_rest_day,
          is_optional: daySource.is_optional,
          status: PlanDayStatus.PENDING,
        }),
      );

      if (daySource.exercises.length === 0) {
        continue;
      }

      await exerciseRepo.save(
        daySource.exercises.map((exercise) =>
          exerciseRepo.create({
            prescribed_day_id: day.id,
            exercise_id: exercise.exercise_id,
            section: exercise.section,
            sets: exercise.sets ?? null,
            reps: exercise.reps ?? null,
            weight_template: exercise.weight_template ?? null,
            rest_seconds: exercise.rest_seconds ?? null,
            duration_seconds: exercise.duration_seconds ?? null,
            distance_meters: exercise.distance_meters ?? null,
            instructions: exercise.instructions ?? null,
            sort_order: exercise.sort_order,
            exercise_name_snapshot: exercise.exercise_name,
          }),
        ),
      );
    }

    await this.outboxService.saveEventEnvelope(
      WORKOUT_EVENT_TYPES.WORKOUT_PLAN_ASSIGNED,
      WORKOUT_EVENT_VERSION,
      organizationId,
      {
        assignmentId: saved.id,
        memberId,
        templateId: source.templateId,
        planTemplateId: source.planTemplateId,
        assignedBy,
        assignedAt: saved.assigned_at.toISOString(),
        startDate,
        endDate,
        loggingMode: source.loggingMode,
      },
      memberId,
      undefined,
      manager,
    );

    return saved;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async listAssignmentsForMember(
    organizationId: string,
    memberId: string,
  ): Promise<WorkoutPlanAssignment[]> {
    await this.tenant.requireMemberInOrganization(memberId, organizationId);
    return this.assignmentRepository.find({
      where: { organization_id: organizationId, member_id: memberId },
      order: { created_at: 'DESC' },
    });
  }

  async getAssignment(
    organizationId: string,
    assignmentId: string,
  ): Promise<WorkoutPlanAssignment> {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId, organization_id: organizationId },
    });
    if (!assignment) {
      throw new NotFoundException('Workout plan assignment not found');
    }
    return assignment;
  }

  async getAssignmentDetail(
    organizationId: string,
    assignmentId: string,
  ): Promise<AssignmentDetail> {
    const assignment = await this.getAssignment(organizationId, assignmentId);
    const days = await this.listPrescribedDaysWithExercises(
      organizationId,
      assignmentId,
    );
    const progress = await this.getProgressForAssignment(
      organizationId,
      assignmentId,
    );
    return { assignment, days, progress };
  }

  async listPrescribedDaysWithExercises(
    organizationId: string,
    assignmentId: string,
  ): Promise<PrescribedDayWithExercises[]> {
    const days = await this.prescribedDayRepository.find({
      where: { organization_id: organizationId, assignment_id: assignmentId },
      order: { sequence_order: 'ASC' },
    });
    if (days.length === 0) {
      return [];
    }
    const exercises = await this.prescribedExerciseRepository.find({
      where: { prescribed_day_id: In(days.map((day) => day.id)) },
      order: { sort_order: 'ASC' },
    });
    const byDay = new Map<string, PrescribedWorkoutDayExercise[]>();
    for (const exercise of exercises) {
      const rows = byDay.get(exercise.prescribed_day_id) ?? [];
      rows.push(exercise);
      byDay.set(exercise.prescribed_day_id, rows);
    }
    return days.map((day) => ({
      ...day,
      exercises: byDay.get(day.id) ?? [],
    }));
  }

  async getPrescribedDay(
    organizationId: string,
    dayId: string,
  ): Promise<PrescribedWorkoutDay> {
    const day = await this.prescribedDayRepository.findOne({
      where: { id: dayId, organization_id: organizationId },
    });
    if (!day) {
      throw new NotFoundException('Prescribed workout day not found');
    }
    return day;
  }

  async getPrescribedDayDetail(
    organizationId: string,
    dayId: string,
  ): Promise<PrescribedDayWithExercises> {
    const day = await this.getPrescribedDay(organizationId, dayId);
    const exercises = await this.prescribedExerciseRepository.find({
      where: { prescribed_day_id: day.id },
      order: { sort_order: 'ASC' },
    });
    return { ...day, exercises };
  }

  /**
   * The rolling workout sequence: prescribed days ordered by
   * `sequence_order`, with the first non-approved day as the current one.
   *
   * No calendar date is consulted and nothing expires. Rest markers are
   * returned for display but never selected as the current workout.
   */
  async getSequence(
    organizationId: string,
    memberId: string,
  ): Promise<SequenceEntry[]> {
    await this.tenant.requireMemberInOrganization(memberId, organizationId);
    const assignments = await this.assignmentRepository.find({
      where: {
        organization_id: organizationId,
        member_id: memberId,
        status: AssignmentStatus.ACTIVE,
      },
      order: { created_at: 'ASC' },
    });

    const entries: SequenceEntry[] = [];
    for (const assignment of assignments) {
      const days = await this.prescribedDayRepository.find({
        where: {
          organization_id: organizationId,
          assignment_id: assignment.id,
        },
        order: { sequence_order: 'ASC' },
      });
      const current = days.find(
        (day) => !day.is_rest_day && day.status !== PlanDayStatus.APPROVED,
      );
      entries.push({
        assignment,
        days,
        current_day_id: current?.id ?? null,
        progress: await this.getProgressForAssignment(
          organizationId,
          assignment.id,
        ),
      });
    }
    return entries;
  }

  // ---------------------------------------------------------------------------
  // Progress — the owner-approved primary formula
  // ---------------------------------------------------------------------------

  /**
   * Primary progress = trainer-approved finished prescribed days / total
   * prescribed (non-rest) days × 100.
   *
   * Submitted, pending and remaining-required days are excluded from the
   * numerator. Sessions, session exercises and repeated exercise rows are not
   * counted at all, so extra sessions can never inflate progress. The result is
   * capped at 100.
   */
  async getProgressForAssignment(
    organizationId: string,
    assignmentId: string,
  ): Promise<AssignmentProgress> {
    await this.getAssignment(organizationId, assignmentId);

    const statusRows: Array<{ status: string; count: string }> =
      await this.prescribedDayRepository
        .createQueryBuilder('day')
        .select('day.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('day.organization_id = :organizationId', { organizationId })
        .andWhere('day.assignment_id = :assignmentId', { assignmentId })
        .andWhere('day.is_rest_day = false')
        .groupBy('day.status')
        .getRawMany();

    const statusCounts = {
      pending: 0,
      submitted: 0,
      remaining_required: 0,
      approved: 0,
    };
    for (const row of statusRows) {
      if (row.status in statusCounts) {
        statusCounts[row.status as keyof typeof statusCounts] = Number(row.count);
      }
    }
    const prescribed =
      statusCounts.pending +
      statusCounts.submitted +
      statusCounts.remaining_required +
      statusCounts.approved;
    const completed = statusCounts.approved;
    const percentage =
      prescribed > 0
        ? Math.min(100, Math.round((completed / prescribed) * 100))
        : 0;

    const exerciseRows: Array<{
      prescribed: string;
      completed: string;
    }> = await this.dataSource.query(
      `
      SELECT
        COUNT(DISTINCT pde.id)::int AS prescribed,
        COUNT(DISTINCT pde.id) FILTER (WHERE pdsx.completed = true)::int AS completed
      FROM "WORKOUTS_PRESCRIBED_DAY_EXERCISES" pde
      INNER JOIN "WORKOUTS_PRESCRIBED_DAYS" pd
        ON pd.id = pde.prescribed_day_id
      LEFT JOIN "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES" pdsx
        ON pdsx.prescribed_day_exercise_id = pde.id
        AND pdsx.completed = true
      WHERE pd.assignment_id = $1
        AND pd.organization_id = $2
        AND pd.is_rest_day = false
      `,
      [assignmentId, organizationId],
    );
    const exercisePrescribed = Number(exerciseRows[0]?.prescribed ?? 0);
    const exerciseCompleted = Number(exerciseRows[0]?.completed ?? 0);

    return {
      completed,
      prescribed,
      percentage,
      status_counts: statusCounts,
      exercise_completion: {
        completed: exerciseCompleted,
        prescribed: exercisePrescribed,
        percentage:
          exercisePrescribed > 0
            ? Math.min(
                100,
                Math.round((exerciseCompleted / exercisePrescribed) * 100),
              )
            : 0,
      },
    };
  }

  /** True when the assignment has any prescribed (non-rest) day. */
  async assignmentHasPrescribedDays(
    organizationId: string,
    assignmentId: string,
  ): Promise<boolean> {
    const count = await this.prescribedDayRepository.count({
      where: {
        organization_id: organizationId,
        assignment_id: assignmentId,
        is_rest_day: false,
      },
    });
    return count > 0;
  }
}
