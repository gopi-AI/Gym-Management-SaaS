import { IsObject, IsOptional } from 'class-validator';
import type { ReportJob } from '../entities/report-job.entity';

/**
 * Report-job DTOs and response shapes (§4.2).
 *
 * **The status response is a deliberate narrowing of the stored row.** §4.2 says
 * `GET /v1/report/jobs/{id}` returns "job status, progress, and result metadata", so
 * this exposes exactly the fields that answer that and omits `organization_id` and
 * `created_by` — neither is part of the documented response, and the caller's own
 * organization is already implied by the tenant scope the read is executed under.
 *
 * **There is no result payload, and its absence is visible rather than implied.**
 * Phase B writes `result_rows` / `result_format` and leaves `result_s3_key` /
 * `result_s3_bucket` null because no bucket is configured (P6-36). Both fields are
 * returned as nulls so a client can tell "no file was produced" from "this API does not
 * report files", and `GET /v1/report/jobs/{id}/download` (§4.2) stays unimplementable
 * until P6-36 lands. A completed job's rows are metrics, not data.
 */
export class ExecuteReportDto {
  /**
   * Values for the definition's `$name` placeholders (§3.1.1). Phase A resolves them
   * while validating, so an unfilled `$placeholder` is rejected as a bad request
   * rather than compiled into the query.
   */
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export interface ReportJobResponse {
  id: string;
  report_schema_id: string | null;
  /** pending | running | completed | failed | cancelled (§3.2). */
  status: string;
  progress_pct: number | null;
  parameters: unknown;
  /** Populated on `completed` — the row count the executor produced. */
  result_rows: number | null;
  /** Populated on `completed` — 'json' today (no exporter exists yet, §8). */
  result_format: string | null;
  /** Always null until P6-36 (no S3 write path). */
  result_s3_key: string | null;
  /** Always null until P6-36 (no bucket configured). */
  result_s3_bucket: string | null;
  /** Populated on `failed` (§10's schema-drift case records Phase A's message here). */
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/** Project a job row onto §4.2's documented response shape. */
export function toReportJobResponse(job: ReportJob): ReportJobResponse {
  return {
    id: job.id,
    report_schema_id: job.report_schema_id ?? null,
    status: job.status,
    progress_pct: job.progress_pct ?? null,
    parameters: job.parameters ?? {},
    result_rows: job.result_rows ?? null,
    result_format: job.result_format ?? null,
    result_s3_key: job.result_s3_key ?? null,
    result_s3_bucket: job.result_s3_bucket ?? null,
    error_message: job.error_message ?? null,
    created_at: job.created_at,
    started_at: job.started_at ?? null,
    completed_at: job.completed_at ?? null,
  };
}
