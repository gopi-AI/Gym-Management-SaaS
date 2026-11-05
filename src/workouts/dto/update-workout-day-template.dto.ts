import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';

/** Partial update of a reusable workout-day template. */
export class UpdateWorkoutDayTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimated_duration_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
