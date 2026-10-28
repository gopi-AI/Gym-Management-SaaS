import {
  IsString,
  IsOptional,
  IsInt,
  IsIn,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MEAL_TYPE_VALUES, MealType } from '../entities/meal-type.enum';

/**
 * Input contract for `DietService.updateMealTemplate()`.
 *
 * This is a concrete class rather than `Partial<CreateMealTemplateDto>` on
 * purpose. With `emitDecoratorMetadata` on (`tsconfig.json`), a `Partial<...>`
 * parameter type emits `Object` into `design:paramtypes`, and the global
 * `ValidationPipe({ whitelist: true, transform: true })` (`src/main.ts`) skips
 * every metatype it does not recognise. A `Partial<...>` `@Body()` would
 * therefore reach the handler with no per-field validation and no whitelist
 * stripping at all — an invalid `mealType` would be accepted and an
 * undecorated key would survive. Every field is declared here with the same
 * decorators as `CreateMealTemplateDto`, all optional for PATCH semantics.
 *
 * `dietPlanId` is present on purpose: moving a template to another plan of the
 * SAME organization is existing service behaviour. `organization_id` is
 * deliberately absent — the authorized organization is resolved from the tenant
 * context inside `DietService` and can never come from the body.
 *
 * EXPLICIT `null` IS REJECTED, NOT IGNORED — `@ValidateIf`, not `@IsOptional`
 * `@IsOptional()` treats `null` exactly like a missing key, so every validator
 * would be skipped and `{"calories": null}` would reach PostgreSQL as
 * `SET "calories" = NULL` against a `NOT NULL` column: a 500, not a 400. Each
 * NOT NULL column therefore uses `@ValidateIf((_, value) => value !== undefined)`,
 * which keeps PATCH semantics for an ABSENT key while making an explicit `null`
 * run the type validator and fail with 400. The single exception is
 * `description`, whose column IS nullable (`1788965263247-CreateDietTables`), so
 * `{"description": null}` stays a legal "clear the description" request.
 */
export class UpdateMealTemplateDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  dietPlanId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(255)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(MEAL_TYPE_VALUES)
  mealType?: MealType;

  /**
   * Nullable column: `null` clears the description, and `@IsOptional()` accepts
   * both `undefined` (leave unchanged) and `null` (clear). Every other field
   * above/below is NOT NULL and rejects `null`.
   */
  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  calories?: number;

  /** Macro grams per single serving (decimal string), as in the create DTO. */
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  proteinG?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  carbsG?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  fatG?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  servingSize?: string;
}
