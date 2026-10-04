import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { isReportJobError } from './report-job.errors';
import { isReportQueryValidationError } from './report-query.errors';

/**
 * Translates Phase A / Phase B's typed domain errors into HTTP responses
 * (P6-04 piece 1).
 *
 * **Why this exists at all.** Neither Phase A nor Phase B throws an `HttpException`:
 * `ReportQueryValidationError` and `ReportJobError` are plain `Error` subclasses whose
 * docblocks say they are "bad request" / "conflict" families a caller can act on. The
 * repository's convention is that a *service* throws the Nest exception (attendance,
 * finance and diet all throw `NotFoundException` / `ConflictException` directly), but
 * Phase A/B are committed and must not be modified, so the translation belongs at the
 * boundary this piece adds. Doing it in one helper — rather than a `@Catch` filter, of
 * which this codebase has none — keeps the mapping testable and avoids introducing a
 * second authorization/error architecture.
 *
 * Anything that is not one of those two types is rethrown unchanged, so a genuine
 * infrastructure failure (a lost connection, a SQL error) surfaces as itself instead of
 * being disguised as a client error.
 *
 * Status mapping:
 *   - `ReportQueryValidationError` → **400**. §3.1.1/§10: the definition itself is
 *     wrong, and §4.1 wants that rejected at *creation* time, not first execution.
 *   - `SCHEMA_NOT_FOUND` → **404**. §10's "Schema not found / org mismatch" row. Note
 *     the lookup is already organization-scoped, so a schema id from another tenant is
 *     a 404 rather than a 403 that would confirm the row exists.
 *   - `JOB_HAS_NO_DEFINITION` → **400**.
 *   - `QUEUE_DEPTH_EXCEEDED` → **429**. §10's "Pending job count exceeded" row: "429 Too
 *     Many Requests with the current pending count and a `Retry-After` header".
 */
export function throwAsHttpException(
  error: unknown,
  options: { retryAfterSeconds?: number } = {},
): never {
  if (isReportQueryValidationError(error)) {
    throw new BadRequestException({
      code: error.code,
      message: error.message,
      detail: error.detail,
    });
  }

  if (isReportJobError(error)) {
    switch (error.code) {
      case 'SCHEMA_NOT_FOUND':
        throw new NotFoundException({
          code: error.code,
          message: error.message,
          detail: error.detail,
        });
      case 'JOB_HAS_NO_DEFINITION':
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          detail: error.detail,
        });
      case 'QUEUE_DEPTH_EXCEEDED':
        // The body carries the current pending count (§10) plus the retry hint; the
        // controller copies `retryAfterSeconds` into the `Retry-After` header, because
        // a header is not reachable from here.
        throw new HttpException(
          {
            code: error.code,
            message: error.message,
            detail: error.detail,
            ...(options.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: options.retryAfterSeconds }
              : {}),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }
  }

  throw error;
}
