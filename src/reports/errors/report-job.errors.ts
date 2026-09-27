/**
 * Typed failures for report-job orchestration (Phase B, P6-02/P6-03).
 *
 * Same split as Phase A's validation errors: every code here is a **bad request** or a
 * **conflict** the caller can understand, never an internal fault. A database outage or
 * an executor crash surfaces as itself, so a caller can tell "your request was refused"
 * from "something broke".
 */
export type ReportJobErrorCode =
  /** §3.2's queue-depth guard: the organization already holds MAX_PENDING_JOBS. */
  | 'QUEUE_DEPTH_EXCEEDED'
  /** The referenced REPORTS_REPORT_SCHEMAS row does not exist for this organization. */
  | 'SCHEMA_NOT_FOUND'
  /** A job was created with neither a schema reference nor an ad-hoc definition. */
  | 'JOB_HAS_NO_DEFINITION';

export class ReportJobError extends Error {
  readonly code: ReportJobErrorCode;
  readonly detail: Record<string, unknown>;

  constructor(code: ReportJobErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ReportJobError';
    this.code = code;
    this.detail = detail;
  }
}

export function isReportJobError(error: unknown): error is ReportJobError {
  return error instanceof ReportJobError;
}
