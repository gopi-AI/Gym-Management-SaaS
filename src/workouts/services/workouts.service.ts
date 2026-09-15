import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Exercise } from '../entities/exercise.entity';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { AssignPlanInput } from '../dto/assign-plan.input';
import { CreateExerciseDto } from '../dto/create-exercise.dto';
import { CreateWorkoutTemplateDto } from '../dto/create-workout-template.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { AssignmentStatus } from '../entities/assignment-status.enum';

/**
 * Single module service for the Workouts domain.
 *
 * **Single-write-path** — all workout plan assignments flow through
 * `assignPlan()`. The method is exported from the module so that the PT module
 * (built next) calls the same method as the REST API controller, guaranteeing
 * identical validation, org-scoping, and event emission regardless of caller.
 */
@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>,
    @InjectRepository(WorkoutTemplate)
    private readonly templateRepository: Repository<WorkoutTemplate>,
    @InjectRepository(WorkoutPlanAssignment)
    private readonly assignmentRepository: Repository<WorkoutPlanAssignment>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
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

  // ---------------------------------------------------------------------------
  // Exercise CRUD (Q5 — strictly org-scoped)
  // ---------------------------------------------------------------------------

  async createExercise(dto: CreateExerciseDto): Promise<Exercise> {
    const exercise = this.exerciseRepository.create(dto);
    return this.exerciseRepository.save(exercise);
  }

  async findAllExercises(): Promise<Exercise[]> {
    const orgId = await this.getOrganizationId();
    return this.exerciseRepository.find({
      where: { organization_id: orgId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findExerciseById(id: string): Promise<Exercise> {
    const orgId = await this.getOrganizationId();
    const exercise = await this.exerciseRepository.findOne({
      where: { id, organization_id: orgId },
    });
    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }
    return exercise;
  }

  // ---------------------------------------------------------------------------
  // WorkoutTemplate CRUD
  // ---------------------------------------------------------------------------

  async createTemplate(dto: CreateWorkoutTemplateDto): Promise<WorkoutTemplate> {
    const template = this.templateRepository.create(dto);
    return this.templateRepository.save(template);
  }

  async findAllTemplates(): Promise<WorkoutTemplate[]> {
    const orgId = await this.getOrganizationId();
    return this.templateRepository.find({
      where: { organization_id: orgId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findTemplateById(id: string): Promise<WorkoutTemplate> {
    const orgId = await this.getOrganizationId();
    const template = await this.templateRepository.findOne({
      where: { id, organization_id: orgId },
    });
    if (!template) {
      throw new NotFoundException('WorkoutTemplate not found');
    }
    return template;
  }

  /**
   * Assign a workout template to a member (single legal write path).
   *
   * Enforces, in order:
   *   1. Org-scoping — template must exist in the caller's org.
   *   2. App-level unique constraint — no active assignment for same
   *      (member, template) pair (belt).
   *   3. DB-level partial unique index — final backstop (suspenders).
   *   4. Transactional outbox event — `WorkoutPlanAssigned.v1`.
   */
  async assignPlan(input: AssignPlanInput): Promise<WorkoutPlanAssignment> {
    const orgId = await this.getOrganizationId();

    return this.dataSource.transaction(async (manager) => {
      // 1. Validate the template exists and belongs to this org
      const templateRepo = manager.getRepository(WorkoutTemplate);
      const template = await templateRepo.findOne({
        where: { id: input.templateId, organization_id: orgId },
      });
      if (!template) {
        throw new NotFoundException(
          `WorkoutTemplate "${input.templateId}" not found in organization`,
        );
      }

      // 2. App-level unique constraint check (belt)
      const assignmentRepo = manager.getRepository(WorkoutPlanAssignment);
      const existing = await assignmentRepo.findOne({
        where: {
          member_id: input.memberId,
          template_id: input.templateId,
          status: AssignmentStatus.ACTIVE,
        },
      });
      if (existing) {
        throw new ConflictException(
          `Member "${input.memberId}" already has an active assignment for template "${input.templateId}"`,
        );
      }


// 3. Create the assignment (status defaults to 'active')
      const assignment = assignmentRepo.create({
        organization_id: orgId,
        member_id: input.memberId,
        template_id: input.templateId,
        assigned_by: input.assignedBy,
        assigned_at: new Date(),
        start_date: input.startDate,
        end_date: input.endDate ?? null,
        notes: input.notes ?? null,
        status: AssignmentStatus.ACTIVE,
      });

      const saved = await assignmentRepo.save(assignment);

      // 4. Outbox event inside the same transaction
      await this.outboxService.saveEventEnvelope(
        'WorkoutPlanAssigned.v1',
        '1',
        orgId,
        {
          assignmentId: saved.id,
          memberId: input.memberId,
          templateId: input.templateId,
          assignedBy: input.assignedBy,
          assignedAt: saved.assigned_at.toISOString(),
          startDate: input.startDate,
          endDate: input.endDate ?? null,
        },
        input.memberId,
        undefined,
        manager,
      );

      return saved;
    });
  }

  async findAllAssignments(memberId: string): Promise<WorkoutPlanAssignment[]> {
    const orgId = await this.getOrganizationId();
    return this.assignmentRepository.find({
      where: { organization_id: orgId, member_id: memberId },
      order: { created_at: 'DESC' },
    });
  }

  async findAssignmentById(id: string): Promise<WorkoutPlanAssignment> {
    const orgId = await this.getOrganizationId();
    const assignment = await this.assignmentRepository.findOne({
      where: { id, organization_id: orgId },
    });
    if (!assignment) {
      throw new NotFoundException('WorkoutPlanAssignment not found');
    }
    return assignment;
  }

  // ---------------------------------------------------------------------------
  // Progress calculation (Q7)
  // ---------------------------------------------------------------------------

  /**
   * Calculate progress for an assignment.
   *
   * progress = (completed exercises across sessions within the date window)
   *           / (prescribed exercises across the same sessions)
   *
   * If no sessions exist within the assignment's date window, progress is 0.
   * There is deliberately NO cumulative-volume computation (sets × reps ×
   * weight) — that was explicitly rejected per Q7.
   *
   * This is a derived query, not a persisted/cached column. For the current
   * workload (a single member's dashboard), this is performant enough. If
   * aggregation over many members becomes a bottleneck, a materialized view
   * or cached column can be added later — but not speculatively.
   */
  async getAssignmentProgress(
    assignmentId: string,
  ): Promise<{ completed: number; prescribed: number; percentage: number }> {
    const orgId = await this.getOrganizationId();

    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId, organization_id: orgId },
    });
    if (!assignment) {
      throw new NotFoundException('WorkoutPlanAssignment not found');
    }

    const result = await this.dataSource.query(
      `
      SELECT
        COALESCE(SUM(CASE
          WHEN wse.sets_completed IS NOT NULL AND wse.reps_completed IS NOT NULL
          THEN 1 ELSE 0
        END), 0)::int AS completed,
        COALESCE(COUNT(wse.id), 0)::int AS prescribed
      FROM "WORKOUTS_WORKOUT_SESSIONS" ws
      INNER JOIN "WORKOUTS_WORKOUT_SESSION_EXERCISES" wse
        ON wse.session_id = ws.id
      WHERE ws.assignment_id = $1
        AND ws.organization_id = $2
        AND ws.session_date >= $3
        AND ($4 IS NULL OR ws.session_date <= $4)
      `,
      [
        assignmentId,
        orgId,
        assignment.start_date,
        assignment.end_date,
      ],
    );

    const completed = Number(result[0]?.completed ?? 0);
    const prescribed = Number(result[0]?.prescribed ?? 0);
    const percentage = prescribed > 0
      ? Math.round((completed / prescribed) * 100)
      : 0;

    return { completed, prescribed, percentage };
  }
}

