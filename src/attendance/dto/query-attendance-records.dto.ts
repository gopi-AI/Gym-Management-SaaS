import { IsOptional, IsInt, Min, IsString, IsUUID, IsDateString, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Attendance record search / dashboard query
 * (`GET /v1/attendance/records`).
 *
 * Mirrors the pagination shape of `ListMembersDto` / `QueryMembershipDto`
 * (page + limit, not cursor pagination) so the frontend consumes it uniformly.
 *
 * `from` / `to` are inclusive ISO-8601 bounds applied to `check_in_time` and are
 * what the dashboard uses to count check-ins for a branch on a given day.
 * `open_only=true` returns members who are currently inside (the front desk's
 * "who is in the gym right now" list and the lookup used before a check-out).
 */
export class QueryAttendanceRecordsDto {
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
  @IsString()
  check_in_method?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  open_only?: boolean;
}
