import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { QueryDefinition } from '../types/query-definition';

/**
 * Report-schema DTOs (§4.1, `docs/api-plan.md` §Reports).
 *
 * **`query_definition` is validated by Phase A, not by this DTO.** The DTO checks only
 * that the field is present and is an object; `ReportQueryValidator.validate()` is then
 * run against real entity metadata, which is the check that can reject an unknown
 * source, an unknown column, a bad aggregate or a bad bucket unit. Duplicating any of
 * that here would create a second, weaker definition of validity.
 *
 * **`category` is length-checked, not enumerated.** §3.1 lists the intended values
 * ('member' | 'finance' | … | 'custom') as a comment and deliberately adds no CHECK
 * constraint — `ReportSchema.category` is a plain varchar with a default for exactly
 * that reason. An `@IsIn` here would make the API stricter than the schema the plan
 * specifies, so the only rule is the column's own width.
 *
 * **`is_system` is absent on purpose**: §6's system rows are seeded (P6-07) and §4.1
 * has no route that may create or flip one. A caller cannot set it.
 */
export class CreateReportSchemaDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** §3.1's category list; the column is varchar(50) with no CHECK constraint. */
  @IsOptional()
  @IsString()
  @Length(1, 50)
  category?: string;

  /** Structured definition (§3.1.1) — never raw SQL. Validated by Phase A on create. */
  @IsObject()
  query_definition!: QueryDefinition;

  /** Declared parameter list (§3.1); element shape is not defined by the plan. */
  @IsOptional()
  @IsArray()
  parameters?: unknown[];
}

/**
 * `PUT /v1/report/schemas/{id}` (§4.1, "Update a custom schema").
 *
 * `is_active` is updatable because `DELETE` deactivates rather than removes the row
 * (`REPORTS_REPORT_JOBS.report_schema_id` is ON DELETE NO ACTION, so a schema that has
 * ever been executed cannot be hard-deleted). Without this field a deactivated schema
 * would be unreachable forever.
 */
export class UpdateReportSchemaDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  category?: string;

  /** Re-validated by Phase A whenever it is supplied. */
  @IsOptional()
  @IsObject()
  query_definition?: QueryDefinition;

  @IsOptional()
  @IsArray()
  parameters?: unknown[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/**
 * `GET /v1/report/schemas` (§4.1, "List active report schemas").
 *
 * Pagination mirrors `QueryMembershipPlanDto`. There is deliberately no `is_active`
 * filter: §4.1 scopes the list to active schemas, and a deactivated schema stays
 * reachable by id (and reactivatable through `PUT`).
 */
export class QueryReportSchemasDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
