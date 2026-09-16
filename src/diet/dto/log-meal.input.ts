import {
  IsUUID,
  IsOptional,
  IsString,
  IsInt,
  IsDateString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Input contract for `DietService.logMeal()`.
 *
 * Two mutually exclusive forms (Q9):
 *   - TEMPLATED: `mealTemplateId` set → macros are computed as
 *     `template_value × servings` at log time. The macro input fields MUST be
 *     left unset — a row must never have both a template reference AND
 *     independently-supplied macros.
 *   - FREE-TEXT: `mealTemplateId` null → `mealDescription` holds the free-text
 *     entry; macros are optional and MAY be supplied manually or left null.
 */
export class LogMealInput {
  @IsUUID()
  memberId!: string;

  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @IsOptional()
  @IsUUID()
  mealTemplateId?: string;

  @ValidateIf((o) => !o.mealTemplateId)
  @IsString()
  @MaxLength(2000)
  mealDescription?: string;

  @IsDateString()
  logDate!: string;

  @IsInt()
  servings!: number;

  // Manually-supplied macros — only valid for FREE-TEXT meals (no template).
  @ValidateIf((o) => !o.mealTemplateId)
  @IsInt()
  calories?: number;

  @ValidateIf((o) => !o.mealTemplateId)
  @IsString()
  proteinG?: string;

  @ValidateIf((o) => !o.mealTemplateId)
  @IsString()
  carbsG?: string;

  @ValidateIf((o) => !o.mealTemplateId)
  @IsString()
  fatG?: string;
}
