import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { WorkoutDayTemplate } from '../entities/workout-day-template.entity';
import { WorkoutDayTemplateExercise } from '../entities/workout-day-template-exercise.entity';
import { WorkoutPlanTemplate } from '../entities/workout-plan-template.entity';
import { WorkoutPlanTemplateDay } from '../entities/workout-plan-template-day.entity';
import { Exercise } from '../entities/exercise.entity';
import { ExerciseSection } from '../entities/exercise-section.enum';
import { CreateWorkoutDayTemplateDto } from '../dto/create-workout-day-template.dto';
import { UpdateWorkoutDayTemplateDto } from '../dto/update-workout-day-template.dto';
import { SetDayTemplateExercisesDto } from '../dto/set-day-template-exercises.dto';
import { CopyWorkoutDayTemplateDto } from '../dto/copy-workout-day-template.dto';
import { CreateWorkoutPlanTemplateDto } from '../dto/create-workout-plan-template.dto';
import { UpdateWorkoutPlanTemplateDto } from '../dto/update-workout-plan-template.dto';
import { SetPlanTemplateDaysDto } from '../dto/set-plan-template-days.dto';

/** A day-template exercise row plus the exercise name for display. */
export interface DayTemplateExerciseView extends WorkoutDayTemplateExercise {
  exercise_name: string | null;
}

export interface DayTemplateDetail {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  estimated_duration_minutes?: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  exercises: DayTemplateExerciseView[];
}

export interface PlanTemplateDetail {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  days: WorkoutPlanTemplateDay[];
}

/**
 * Reusable workout-day and weekly-plan template composition.
 *
 * Copying a day template creates a fully independent row set; updating or
 * deleting a source template never touches a copy, an assignment, or a
 * previously snapshotted prescribed day.
 */
@Injectable()
export class WorkoutTemplatesService {
  constructor(
    @InjectRepository(WorkoutDayTemplate)
    private readonly dayTemplateRepository: Repository<WorkoutDayTemplate>,
    @InjectRepository(WorkoutDayTemplateExercise)
    private readonly dayTemplateExerciseRepository: Repository<WorkoutDayTemplateExercise>,
    @InjectRepository(WorkoutPlanTemplate)
    private readonly planTemplateRepository: Repository<WorkoutPlanTemplate>,
    @InjectRepository(WorkoutPlanTemplateDay)
    private readonly planTemplateDayRepository: Repository<WorkoutPlanTemplateDay>,
    @InjectRepository(Exercise)
    private readonly exerciseRepository: Repository<Exercise>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Workout-day templates
  // ---------------------------------------------------------------------------

  async createDayTemplate(
    organizationId: string,
    dto: CreateWorkoutDayTemplateDto,
  ): Promise<WorkoutDayTemplate> {
    return this.dayTemplateRepository.save(
      this.dayTemplateRepository.create({
        organization_id: organizationId,
        name: dto.name,
        description: dto.description ?? null,
        estimated_duration_minutes: dto.estimated_duration_minutes ?? null,
        is_active: dto.is_active ?? true,
      }),
    );
  }

  async listDayTemplates(
    organizationId: string,
  ): Promise<WorkoutDayTemplate[]> {
    return this.dayTemplateRepository.find({
      where: { organization_id: organizationId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async getDayTemplate(
    organizationId: string,
    id: string,
  ): Promise<DayTemplateDetail> {
    const template = await this.dayTemplateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!template) {
      throw new NotFoundException('Workout day template not found');
    }
    return this.buildDayTemplateDetail(template);
  }

  async updateDayTemplate(
    organizationId: string,
    id: string,
    dto: UpdateWorkoutDayTemplateDto,
  ): Promise<WorkoutDayTemplate> {
    const template = await this.dayTemplateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!template) {
      throw new NotFoundException('Workout day template not found');
    }
    if (dto.name !== undefined) template.name = dto.name;
    if (dto.description !== undefined) template.description = dto.description;
    if (dto.estimated_duration_minutes !== undefined) {
      template.estimated_duration_minutes = dto.estimated_duration_minutes;
    }
    if (dto.is_active !== undefined) template.is_active = dto.is_active;
    return this.dayTemplateRepository.save(template);
  }

  /**
   * Replace the complete ordered exercise composition of a day template.
   *
   * The whole set is validated before anything is deleted: every exercise must
   * exist in the caller's organization. The operation is transactional, so a
   * failed insert cannot leave a half-composed template.
   */
  async setDayTemplateExercises(
    organizationId: string,
    id: string,
    dto: SetDayTemplateExercisesDto,
  ): Promise<DayTemplateDetail> {
    const template = await this.dayTemplateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!template) {
      throw new NotFoundException('Workout day template not found');
    }

    const exerciseIds = [...new Set(dto.exercises.map((e) => e.exercise_id))];
    await this.assertExercisesBelongToOrganization(organizationId, exerciseIds);

    await this.dataSource.transaction(async (manager) => {
      const rowRepo = manager.getRepository(WorkoutDayTemplateExercise);
      await rowRepo.delete({ day_template_id: id });

      if (dto.exercises.length === 0) {
        return;
      }

      const rows = dto.exercises.map((exercise) =>
        rowRepo.create({
          day_template_id: id,
          exercise_id: exercise.exercise_id,
          section: exercise.section ?? ExerciseSection.STRENGTH,
          sets: exercise.sets ?? null,
          reps: exercise.reps ?? null,
          weight_template: exercise.weight_template ?? null,
          rest_seconds: exercise.rest_seconds ?? null,
          duration_seconds: exercise.duration_seconds ?? null,
          distance_meters: exercise.distance_meters ?? null,
          instructions: exercise.instructions ?? null,
          sort_order: exercise.sort_order,
        }),
      );
      await rowRepo.save(rows);
    });

    return this.getDayTemplate(organizationId, id);
  }

  /**
   * Copy a day template, including its complete exercise composition.
   *
   * The copy is a new `WORKOUTS_WORKOUT_DAY_TEMPLATES` row with new exercise
   * rows. There is no shared row between the source and the copy, so editing
   * either one never changes the other.
   */
  async copyDayTemplate(
    organizationId: string,
    id: string,
    dto: CopyWorkoutDayTemplateDto,
  ): Promise<DayTemplateDetail> {
    const source = await this.dayTemplateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!source) {
      throw new NotFoundException('Workout day template not found');
    }

    const sourceExercises = await this.dayTemplateExerciseRepository.find({
      where: { day_template_id: id },
      order: { sort_order: 'ASC' },
    });

    const defaultName = `${source.name} (copy)`.slice(0, 255);

    const copyId = await this.dataSource.transaction(async (manager) => {
      const templateRepo = manager.getRepository(WorkoutDayTemplate);
      const rowRepo = manager.getRepository(WorkoutDayTemplateExercise);

      const copy = await templateRepo.save(
        templateRepo.create({
          organization_id: organizationId,
          name: dto.name ?? defaultName,
          description: source.description ?? null,
          estimated_duration_minutes:
            source.estimated_duration_minutes ?? null,
          is_active: true,
        }),
      );

      if (sourceExercises.length > 0) {
        const rows = sourceExercises.map((exercise) =>
          rowRepo.create({
            day_template_id: copy.id,
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
          }),
        );
        await rowRepo.save(rows);
      }

      return copy.id;
    });

    return this.getDayTemplate(organizationId, copyId);
  }

  // ---------------------------------------------------------------------------
  // Weekly plan templates
  // ---------------------------------------------------------------------------

  async createPlanTemplate(
    organizationId: string,
    dto: CreateWorkoutPlanTemplateDto,
  ): Promise<WorkoutPlanTemplate> {
    return this.planTemplateRepository.save(
      this.planTemplateRepository.create({
        organization_id: organizationId,
        name: dto.name,
        description: dto.description ?? null,
        is_active: dto.is_active ?? true,
      }),
    );
  }

  async listPlanTemplates(
    organizationId: string,
  ): Promise<WorkoutPlanTemplate[]> {
    return this.planTemplateRepository.find({
      where: { organization_id: organizationId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async getPlanTemplate(
    organizationId: string,
    id: string,
  ): Promise<PlanTemplateDetail> {
    const template = await this.planTemplateRepository.findOne({
      where: { id, organization_id: organizationId },
      relations: ['days', 'days.day_template'],
    });
    if (!template) {
      throw new NotFoundException('Workout plan template not found');
    }
    const days = [...(template.days ?? [])].sort(
      (a, b) => a.day_order - b.day_order,
    );
    return { ...template, days };
  }

  async updatePlanTemplate(
    organizationId: string,
    id: string,
    dto: UpdateWorkoutPlanTemplateDto,
  ): Promise<WorkoutPlanTemplate> {
    const template = await this.planTemplateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!template) {
      throw new NotFoundException('Workout plan template not found');
    }
    if (dto.name !== undefined) template.name = dto.name;
    if (dto.description !== undefined) template.description = dto.description;
    if (dto.is_active !== undefined) template.is_active = dto.is_active;
    return this.planTemplateRepository.save(template);
  }

  /**
   * Replace the complete ordered day list of a weekly plan template.
   *
   * Rest slots are explicit rows (`is_rest_day = true`) with no day template;
   * every training slot must reference an active day template in the same
   * organization. Duplicate `day_order` values are rejected before the
   * transaction, rather than relying on the database's unique index to produce
   * a 500.
   */
  async setPlanTemplateDays(
    organizationId: string,
    id: string,
    dto: SetPlanTemplateDaysDto,
  ): Promise<PlanTemplateDetail> {
    const template = await this.planTemplateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!template) {
      throw new NotFoundException('Workout plan template not found');
    }

    const orders = dto.days.map((day) => day.day_order);
    if (new Set(orders).size !== orders.length) {
      throw new BadRequestException('day_order values must be unique');
    }

    for (const day of dto.days) {
      if (day.is_rest_day && day.day_template_id) {
        throw new BadRequestException(
          'A rest day cannot reference a workout day template',
        );
      }
      if (!day.is_rest_day && !day.day_template_id) {
        throw new BadRequestException(
          'A training day must reference a workout day template',
        );
      }
    }

    const dayTemplateIds = [
      ...new Set(
        dto.days
          .map((day) => day.day_template_id)
          .filter((value): value is string => !!value),
      ),
    ];
    if (dayTemplateIds.length > 0) {
      const templates = await this.dayTemplateRepository.find({
        where: {
          id: In(dayTemplateIds),
          organization_id: organizationId,
          is_active: true,
        },
      });
      if (templates.length !== dayTemplateIds.length) {
        throw new BadRequestException(
          'One or more workout day templates do not exist in this organization',
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const dayRepo = manager.getRepository(WorkoutPlanTemplateDay);
      await dayRepo.delete({ plan_template_id: id });

      if (dto.days.length === 0) {
        return;
      }

      const rows = dto.days.map((day) =>
        dayRepo.create({
          plan_template_id: id,
          day_template_id: day.day_template_id ?? null,
          day_order: day.day_order,
          day_label: day.day_label ?? null,
          is_rest_day: day.is_rest_day ?? false,
          is_optional: day.is_optional ?? false,
        }),
      );
      await dayRepo.save(rows);
    });

    return this.getPlanTemplate(organizationId, id);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async buildDayTemplateDetail(
    template: WorkoutDayTemplate,
  ): Promise<DayTemplateDetail> {
    const exercises = await this.dayTemplateExerciseRepository.find({
      where: { day_template_id: template.id },
      order: { sort_order: 'ASC' },
    });

    const exerciseIds = [...new Set(exercises.map((row) => row.exercise_id))];
    const library =
      exerciseIds.length > 0
        ? await this.exerciseRepository.find({
            where: { id: In(exerciseIds), organization_id: template.organization_id },
          })
        : [];
    const names = new Map(library.map((exercise) => [exercise.id, exercise.name]));

    return {
      id: template.id,
      organization_id: template.organization_id,
      name: template.name,
      description: template.description,
      estimated_duration_minutes: template.estimated_duration_minutes,
      is_active: template.is_active,
      created_at: template.created_at,
      updated_at: template.updated_at,
      exercises: exercises.map((row) => ({
        ...row,
        exercise_name: names.get(row.exercise_id) ?? null,
      })),
    };
  }

  private async assertExercisesBelongToOrganization(
    organizationId: string,
    exerciseIds: string[],
  ): Promise<void> {
    if (exerciseIds.length === 0) {
      return;
    }
    const exercises = await this.exerciseRepository.find({
      where: { id: In(exerciseIds), organization_id: organizationId },
    });
    if (exercises.length !== exerciseIds.length) {
      throw new BadRequestException(
        'One or more exercises do not exist in this organization',
      );
    }
  }
}
