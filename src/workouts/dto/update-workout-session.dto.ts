import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SessionExerciseInputDto } from './create-workout-session.dto';

/**
 * Edit an in-progress session.
 *
 * `exercises`, when present, replaces the session's exercise log set. A
 * finished or cancelled session rejects every edit.
 */
export class UpdateWorkoutSessionDto {
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
