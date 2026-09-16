import {
  IsString,
  IsOptional,
  IsInt,
  IsIn,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MEAL_TYPE_VALUES, MealType } from '../entities/meal-type.enum';

/**
 * Input contract for `DietService.createMealTemplate()`.
 *
 * Macros are the values PER SINGLE SERVING; the template itself is immutable
 * from the log's perspective (Q10 snapshot rule). Editing a template NEVER
 * retroactively changes past `NutritionLog` rows.
 */
export class CreateMealTemplateDto {
  @IsUUID()
  dietPlanId!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsIn(MEAL_TYPE_VALUES)
  mealType!: MealType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  calories!: number;

  /** Macro grams per single serving (decimal). */
  @IsString()
  proteinG!: string;

  @IsString()
  carbsG!: string;

  @IsString()
  fatG!: string;

  @IsString()
  servingSize!: string;
}
