import { IsOptional, IsInt, Min, IsUUID, IsDateString, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Access decision search (`GET /v1/attendance/access-decisions`).
 *
 * `is_granted=false` is the "who was refused entry, and why" audit view.
 *
 * The decisions table itself carries no `organization_id` (docs/database-plan.md
 * ERD), so the service scopes it by joining the attendance event that owns the
 * tenancy column — which also lets `member_id` / `branch_id` filter on the event.
 */
export class QueryAccessDecisionsDto {
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
  @IsUUID()
  member_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_granted?: boolean;
}
