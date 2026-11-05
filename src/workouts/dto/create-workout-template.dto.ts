import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  MaxLength,
} from 'class-validator';

/**
 * Legacy flat-template creation body.
 *
 * The org is derived from request context, never from this body. New trainer
 * composition uses workout-day and weekly-plan templates; this remains for the
 * legacy `WorkoutTemplate` rows the PT flow assigns.
 */
export class CreateWorkoutTemplateDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  difficulty_level?: string;

  @IsOptional()
  @IsInt()
  estimated_duration_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
