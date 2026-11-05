import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Copy a reusable workout-day template into an independent new template. */
export class CopyWorkoutDayTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
