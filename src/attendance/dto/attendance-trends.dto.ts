import { IsOptional, IsIn, IsUUID, IsDateString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Trend period for check-in aggregation
 * (`GET /v1/attendance/members/:memberId/trends`).
 */
export type TrendPeriod = 'week' | 'month' | 'quarter';

/** Query DTO for `getMemberCheckInTrends`. */
export class QueryMemberTrendsDto {
  @IsIn(['week', 'month', 'quarter'] as const)
  period!: TrendPeriod;
}

/** One data point in a trend series. */
export interface CheckInTrendPoint {
  /** Calendar date label (`YYYY-MM-DD` for daily, `YYYY-MM` for monthly). */
  label: string;
  /** Number of distinct days with a check-in in this bucket. */
  checkInDays: number;
  /** Total check-in events in this bucket. */
  totalCheckIns: number;
}

/** Return type of `getMemberCheckInTrends`. */
export interface CheckInTrendSeries {
  memberId: string;
  period: TrendPeriod;
  /** Ordered chronologically, earliest first. */
  points: CheckInTrendPoint[];
}

/** Return type of `getMemberAttendanceStreak`. */
export interface MemberStreakResult {
  memberId: string;
  currentStreak: number;
  longestStreak: number;
  lastVisitDate: string | null; // ISO-8601 date (YYYY-MM-DD)
}

/** Return type of `getMemberAttendanceHistory`. */
export interface MemberHistoryPoint {
  date: string; // YYYY-MM-DD
  checkInCount: number;
  firstCheckIn: string | null; // ISO timestamp
  lastCheckIn: string | null; // ISO timestamp
}

/** Return type of `getMemberSummaryForHeader`. */
export interface MemberAttendanceSummary {
  memberId: string;
  lastCheckIn: string | null; // ISO timestamp
  todayCheckedIn: boolean;
  totalVisitsThisMonth: number; // distinct days with check-in
}

/**
 * Query DTO for `getMemberAttendanceHistory`.
 */
export class QueryMemberHistoryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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