import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One exercise log inside a workout session. */
export class SessionExerciseInputDto {
  @IsUUID()
  exercise_id!: string;

  /** Required for a plan-day session; must belong to that prescribed day. */
  @IsOptional()
  @IsUUID()
  prescribed_day_exercise_id?: string;

  /** Regular-member checkbox. */
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  /** PT-member actuals. */
  @IsOptional()
  @IsInt()
  @Min(0)
  sets_completed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reps_completed?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  weight_used?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  rpe?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * Start a workout session.
 *
 * A session is always created in the `in_progress` state. It may be standalone
 * (no assignment/prescribed day) or attached to a prescribed day; attaching to
 * a day does not complete or duplicate that day.
 */
export class CreateWorkoutSessionDto {
  @IsOptional()
  @IsDateString()
  session_date?: string;

  @IsOptional()
  @IsUUID()
  assignment_id?: string;

  @IsOptional()
  @IsUUID()
  prescribed_day_id?: string;

  @IsOptional()
  @IsUUID()
  template_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  mood?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration_minutes?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionExerciseInputDto)
  exercises?: SessionExerciseInputDto[];
}
