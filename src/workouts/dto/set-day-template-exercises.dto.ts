import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
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
import { ExerciseSection } from '../entities/exercise-section.enum';

/** One trainer-authored exercise row inside a workout-day template. */
export class DayTemplateExerciseInputDto {
  @IsUUID()
  exercise_id!: string;

  @IsOptional()
  @IsEnum(ExerciseSection)
  section?: ExerciseSection;

  @IsOptional()
  @IsInt()
  @Min(0)
  sets?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reps?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  weight_template?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rest_seconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  distance_meters?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  sort_order!: number;
}

/**
 * Replace the complete composition of a workout-day template.
 *
 * Replacing is intentional: the whole ordered set is trainer-authored in one
 * edit, so a partial merge could leave stale rows behind.
 */
export class SetDayTemplateExercisesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayTemplateExerciseInputDto)
  exercises!: DayTemplateExerciseInputDto[];
}
