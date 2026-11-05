import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exercise } from '../entities/exercise.entity';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { WorkoutSession } from '../entities/workout-session.entity';
import { AssignPlanInput } from '../dto/assign-plan.input';
import { CreateExerciseDto } from '../dto/create-exercise.dto';
import { CreateWorkoutTemplateDto } from '../dto/create-workout-template.dto';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { ExerciseLibraryService } from './exercise-library.service';
import { WorkoutAssignmentsService } from './workout-assignments.service';
import { WorkoutSessionsService } from './workout-sessions.service';
import { AssignmentProgress } from './workout-assignments.service';

/**
 * Module facade retained for the PT integration and the Member 360 tab.
 *
 * `PT → WorkoutsService.assignPlan()` remains the single legacy assignment
 * write path, and the tab's read shape stays stable. The implementation now
 * lives in the focused services so assignment snapshots, progress, session
 * lifecycle and reviews each have one owner.
 */
@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>,
    @InjectRepository(WorkoutTemplate)
    private readonly templateRepository: Repository<WorkoutTemplate>,
    private readonly tenant: WorkoutsTenantService,
    private readonly exerciseLibrary: ExerciseLibraryService,
    private readonly assignments: WorkoutAssignmentsService,
    private readonly sessions: WorkoutSessionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Exercise library (delegates)
  // ---------------------------------------------------------------------------

  async createExercise(dto: CreateExerciseDto): Promise<Exercise> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.create(organizationId, dto);
  }

  async findAllExercises(): Promise<Exercise[]> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.findAll(organizationId);
  }

  async findExerciseById(id: string): Promise<Exercise> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.exerciseLibrary.findOne(organizationId, id);
  }

  // ---------------------------------------------------------------------------
  // Legacy flat templates
  // ---------------------------------------------------------------------------

  async createTemplate(
    dto: CreateWorkoutTemplateDto,
  ): Promise<WorkoutTemplate> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templateRepository.save(
      this.templateRepository.create({
        organization_id: organizationId,
        name: dto.name,
        description: dto.description ?? null,
        difficulty_level: dto.difficulty_level ?? null,
        estimated_duration_minutes: dto.estimated_duration_minutes ?? null,
        is_active: dto.is_active ?? true,
      }),
    );
  }

  async findAllTemplates(): Promise<WorkoutTemplate[]> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templateRepository.find({
      where: { organization_id: organizationId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findTemplateById(id: string): Promise<WorkoutTemplate> {
    const organizationId = await this.tenant.getOrganizationId();
    const template = await this.templateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!template) {
      throw new NotFoundException('WorkoutTemplate not found');
    }
    return template;
  }

  // ---------------------------------------------------------------------------
  // Assignments (single legacy write path used by PT)
  // ---------------------------------------------------------------------------

  async assignPlan(input: AssignPlanInput): Promise<WorkoutPlanAssignment> {
    return this.assignments.assignLegacyPlan(input);
  }

  async findAllAssignments(memberId: string): Promise<WorkoutPlanAssignment[]> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.assignments.listAssignmentsForMember(organizationId, memberId);
  }

  async findAssignmentById(id: string): Promise<WorkoutPlanAssignment> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.assignments.getAssignment(organizationId, id);
  }

  async findAllSessions(memberId: string): Promise<WorkoutSession[]> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.sessions.listMemberSessions(organizationId, memberId);
  }

  /**
   * Primary plan progress is now approved prescribed days / prescribed days.
   * The method name and `{completed, prescribed, percentage}` shape are kept for
   * the existing tab contract; the values are day-based, never exercise-row
   * based.
   */
  async getAssignmentProgress(
    assignmentId: string,
  ): Promise<AssignmentProgress> {
    const organizationId = await this.tenant.getOrganizationId();
    return this.assignments.getProgressForAssignment(
      organizationId,
      assignmentId,
    );
  }
}
