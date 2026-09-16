import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  MaxLength,
} from 'class-validator';

/**
 * Input contract for `DietService.createDietPlan()`.
 */
export class CreateDietPlanDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  total_calories_per_day?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
