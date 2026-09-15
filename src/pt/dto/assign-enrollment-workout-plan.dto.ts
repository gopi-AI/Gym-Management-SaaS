import {
  IsUUID,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
} from 'class-validator';

/**
 * Input for assigning a workout plan to a member in the context of a PT
 * enrollment (naming-collision resolution: `PT → WorkoutsService.assignPlan()`).
 *
 * This is an explicit action, not an implicit effect of enrollment creation. The
 * PT module creates NO assignment row itself: the values below are forwarded,
 * unchanged, to `WorkoutsService.assignPlan()`, which owns validation,
 * org-scoping, the transaction and the `WorkoutPlanAssigned.v1` outbox event.
 *
 * `start_date` / `end_date` default to the enrollment's own dates when omitted.
 */
export class AssignEnrollmentWorkoutPlanDto {
  /** `WORKOUTS_WORKOUT_TEMPLATES` id (Workouts owns exercise/template content). */
  @IsUUID()
  template_id!: string;

  /** User (or "system"/"self") recorded as the assigner by Workouts. */
  @IsString()
  @MaxLength(100)
  assigned_by!: string;

  @IsDateString()
  @IsOptional()
  start_date?: string;

  @IsDateString()
  @IsOptional()
  end_date?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  notes?: string;
}