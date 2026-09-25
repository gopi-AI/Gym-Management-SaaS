/**
 * Typed failures for `QueryDefinition` validation (Phase A, P6-02/P6-03).
 *
 * Every code here means the **caller's definition** is wrong: this is the "bad
 * request" family. Anything else thrown while executing (a lost connection, a
 * Postgres error surfacing at run time, a schema drift that only the database can
 * see) is deliberately NOT wrapped in this type, so a caller can tell "fix your
 * definition" from "retry or escalate" without parsing messages.
 */
export type ReportQueryErrorCode =
  | 'EMPTY_COLUMNS'
  | 'UNKNOWN_SOURCE'
  | 'SOURCE_NOT_TENANT_SCOPED'
  | 'UNKNOWN_COLUMN'
  | 'INVALID_AGGREGATE'
  | 'INVALID_BUCKET_UNIT'
  | 'INVALID_OPERATOR'
  | 'FILTER_VALUE_TYPE_MISMATCH'
  | 'MISSING_FILTER_VALUE'
  | 'SCOPING_COLUMN_IN_DEFINITION'
  | 'UNKNOWN_OUTPUT_ALIAS'
  | 'INVALID_GROUP_TARGET'
  | 'INVALID_ORDER_DIRECTION'
  | 'INVALID_LIMIT';

export class ReportQueryValidationError extends Error {
  readonly code: ReportQueryErrorCode;
  readonly detail: Record<string, unknown>;

  constructor(code: ReportQueryErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ReportQueryValidationError';
    this.code = code;
    this.detail = detail;
  }
}

/** Narrowing helper, so callers do not have to `instanceof` by hand. */
export function isReportQueryValidationError(
  error: unknown,
): error is ReportQueryValidationError {
  return error instanceof ReportQueryValidationError;
}
