import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';

/** Create a reusable workout-day template. Org comes from request context. */
export class CreateWorkoutDayTemplateDto {
  @IsString()
  @MaxLength(255)
  name!: string;

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
