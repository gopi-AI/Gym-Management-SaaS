import { IsOptional, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Filter for `GET /v1/meal-templates`.
 *
 * `dietPlanId` is a FILTER, not a parent selector. It is deliberately not
 * validated against the organization: `DietService.findAllMealTemplates()`
 * always ANDs `organization_id` into its predicate, so an id that belongs to
 * another organization (or to no row at all) simply yields an empty list
 * rather than a 404. The response therefore never reveals whether a foreign
 * plan id exists.
 */
export class QueryMealTemplateDto {
  @IsOptional()
  @Type(() => String)
  @IsUUID()
  dietPlanId?: string;
}
