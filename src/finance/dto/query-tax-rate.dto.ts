import { IsOptional, IsInt, Min, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Tax-rate search query (`GET /v1/tax-rates`): page/limit plus an `is_active`
 * filter. `is_active` is what an admin screen needs in order to see retired rates.
 *
 * `is_active` is parsed with `@Transform` rather than the `@Type(() => Boolean)`
 * that `QueryMembershipPlanDto` uses, because `Boolean('false')` is `true`: with
 * `@Type`, `?is_active=false` would silently filter for ACTIVE rates — the exact
 * opposite of what was asked for — and would pass validation while doing it. The
 * explicit comparison against `true` / `'true'` is the form
 * `QueryInvoiceDto.outstanding_only` already uses. `ValidationPipe` runs with
 * `transform: true` (`src/main.ts`), so this transform is what the endpoint
 * actually applies.
 */
export class QueryTaxRateDto {
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

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_active?: boolean;
}
