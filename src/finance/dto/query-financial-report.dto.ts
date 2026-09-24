import { IsOptional, IsDateString, IsUUID, IsIn } from 'class-validator';
import { REPORT_PERIODS, ReportPeriod } from '../ledger.constants';

/**
 * Query for the finance reporting endpoints
 * (`GET /v1/financial-reports/revenue-summary`), per `docs/phase3-scoping-plan.md`
 * §1: `from`, `to`, `branchId`, `period`.
 *
 * Naming follows the other finance query DTOs (`QueryInvoiceDto`,
 * `QueryPaymentDto`), which use snake_case request fields (`branch_id`), so the
 * wire format stays uniform across the finance resource.
 *
 * `from`/`to` are compared against the day-granular `period_start` column, so
 * they are inclusive whole days: `to=2026-01-31` includes everything that
 * happened on the 31st.
 */
export class QueryFinancialReportDto {
  /** Inclusive lower bound (`YYYY-MM-DD` or a full ISO timestamp). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound (`YYYY-MM-DD` or a full ISO timestamp). */
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  /** Roll-up granularity; the view stores day rows. Defaults to `month`. */
  @IsOptional()
  @IsIn(REPORT_PERIODS)
  period?: ReportPeriod = 'month';
}
