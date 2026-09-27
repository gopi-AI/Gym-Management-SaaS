import { IsOptional, IsInt, Min, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Membership-plan search query (`GET /v1/membership-plans`): page/limit plus an
 * `is_active` filter, which is what an admin screen needs in order to see retired
 * plans.
 *
 * `is_active` is parsed with `@Transform` rather than `@Type(() => Boolean)`,
 * because `Boolean('false')` is `true`: with `@Type`, `?is_active=false` would
 * silently filter for ACTIVE plans — the exact opposite of what was asked for —
 * and would pass `@IsBoolean()` while doing it. It matters here because
 * `MembershipPlansService.findAll()` only adds the filter when the value is not
 * `undefined`, so a dropped `false` is also indistinguishable from "did not
 * filter". The explicit comparison against `true` / `'true'` is the form
 * `QueryTaxRateDto.is_active` and `QueryInvoiceDto.outstanding_only` already use.
 * `ValidationPipe` runs with `transform: true` (`src/main.ts`), so this transform
 * is what the endpoint actually applies.
 */
export class QueryMembershipPlanDto {
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