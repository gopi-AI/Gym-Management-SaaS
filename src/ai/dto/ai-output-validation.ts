/**
 * Shared contract for validating UNTRUSTED model output.
 *
 * Both CURRENT AI use cases — retention analysis and plan-performance analysis —
 * receive a JSON object produced by the model and must apply exactly the same
 * containment rules before any of it reaches an HTTP response or the audit
 * trail:
 *
 * - structural violations fail CLOSED with a single error type, which
 *   `AiService` classifies into HTTP semantics and into the audit trail via
 *   `instanceof` (a second, parallel error class would be mis-classified);
 * - field readers never coerce types and never invent defaults;
 * - text is trimmed and length-bounded by the server, never by the model.
 *
 * These helpers were previously carried as byte-identical, private copies
 * inside `retention-response.dto.ts` and `plan-performance-response.dto.ts`.
 * Keeping ONE implementation means a hardening fix can never be applied to only
 * one of the two use cases.
 *
 * Deliberately NOT here: feature-specific business contracts (retention rates,
 * members, plans, recommendations) — those stay owned by their own DTO modules.
 * This module knows nothing about either use case.
 */

/**
 * Raised when the model does not honour the declared response contract.
 *
 * Owned by this shared module so that every AI use case throws the SAME class;
 * `AiService.classifyErrorCode()`/`toHttpException()` rely on `instanceof`.
 */
export class AiOutputValidationError extends Error {
  readonly code = 'AI_MALFORMED_RESPONSE';

  constructor(message: string) {
    super(message);
    this.name = 'AiOutputValidationError';
  }
}

/** True for a non-null, non-array JSON object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a finite number within `[min, max]`, or fails closed. */
export function readNumber(
  source: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AiOutputValidationError(
      `AI output field "${field}" must be a number in [${min}, ${max}]`,
    );
  }
  return value;
}

/**
 * Reads a trimmed, length-bounded string.
 *
 * Empty strings always fail unless `allowEmpty` is set: the default is the
 * strict behaviour both use cases need for required prose fields, while
 * optional advisory fields opt in explicitly.
 */
export function readString(
  source: Record<string, unknown>,
  field: string,
  maxLength: number,
  allowEmpty = false,
): string {
  const value = source[field];
  if (typeof value !== 'string') {
    throw new AiOutputValidationError(`AI output field "${field}" must be a string`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed === '') {
    throw new AiOutputValidationError(`AI output field "${field}" must not be empty`);
  }
  return trimmed.slice(0, maxLength);
}
