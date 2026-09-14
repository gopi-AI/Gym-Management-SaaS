import {
  RETENTION_MAX_AT_RISK,
  RETENTION_MAX_SUMMARY_LENGTH,
} from '../prompts/retention.prompt';
// Shared AI contract: the error taxonomy and the strict field readers are owned
// by ONE module used by every AI use case (see ai-output-validation.ts).
import {
  AiOutputValidationError,
  isPlainObject,
  readNumber,
  readString,
} from './ai-output-validation';

/**
 * Re-exported so the error taxonomy keeps a single import path for this use
 * case; the class itself stays owned by the shared AI contract (no duplicate).
 */
export { AiOutputValidationError } from './ai-output-validation';

export interface RetentionAtRiskMemberDto {
  member_id: string;
  name: string;
  risk_score: number;
  risk_factors: string[];
  recommended_action: string;
}

/**
 * Public API response.
 *
 * `organization_id` and `generated_at` are set by the server (never by the
 * model) so the tenant identity of a response can never be spoofed.
 */
export interface RetentionAnalysisResponseDto {
  organization_id: string;
  retention_rate: number;
  total_members: number;
  at_risk_count: number;
  at_risk_members: RetentionAtRiskMemberDto[];
  summary: string;
  generated_at: string;
}

/** Normalized, validated subset of the model output. */
export interface ValidatedRetentionModelOutput {
  retention_rate: number;
  at_risk_members: RetentionAtRiskMemberDto[];
  summary: string;
}

/**
 * Strict validator/sanitizer for the model's structured output.
 *
 * Threat model:
 * - the model output is UNTRUSTED;
 * - it must never be able to surface a member id outside the authorized,
 *   organization-scoped dataset, so unknown ids are dropped rather than
 *   rejected (defence in depth) and the display name always comes from the
 *   server-side dataset;
 * - structural violations (wrong types, out-of-range numbers, missing
 *   required fields) fail closed with {@link AiOutputValidationError}.
 */
export function validateRetentionModelOutput(
  raw: unknown,
  authorizedMembers: ReadonlyMap<string, string>,
): ValidatedRetentionModelOutput {
  if (!isPlainObject(raw)) {
    throw new AiOutputValidationError('AI output is not a JSON object');
  }

  const retentionRate = readNumber(raw, 'retention_rate', 0, 1);
  readNonNegativeInt(raw, 'total_members');
  readNonNegativeInt(raw, 'at_risk_count');
  const summary = readString(raw, 'summary', RETENTION_MAX_SUMMARY_LENGTH);

  const rawMembers = raw.at_risk_members;
  if (rawMembers !== undefined && !Array.isArray(rawMembers)) {
    throw new AiOutputValidationError('AI output field "at_risk_members" must be an array');
  }

  const seen = new Set<string>();
  const atRiskMembers: RetentionAtRiskMemberDto[] = [];

  for (const entry of (rawMembers ?? []) as unknown[]) {
    if (!isPlainObject(entry)) {
      throw new AiOutputValidationError('AI output "at_risk_members" entries must be objects');
    }
    const memberId = entry.member_id;
    if (typeof memberId !== 'string' || memberId.trim() === '') {
      throw new AiOutputValidationError('AI output member entry is missing a string member_id');
    }
    // Tenant containment: anything outside the authorized dataset is discarded.
    const authorizedName = authorizedMembers.get(memberId);
    if (authorizedName === undefined || seen.has(memberId)) {
      continue;
    }
    seen.add(memberId);

    atRiskMembers.push({
      member_id: memberId,
      // Name is always taken from the authorized dataset, never from the model.
      name: authorizedName,
      risk_score: readNumber(entry, 'risk_score', 0, 1),
      risk_factors: readStringArray(entry, 'risk_factors'),
      recommended_action: readString(entry, 'recommended_action', 500, true),
    });

    if (atRiskMembers.length >= RETENTION_MAX_AT_RISK) {
      break;
    }
  }

  atRiskMembers.sort((a, b) =>
    b.risk_score === a.risk_score ? a.member_id.localeCompare(b.member_id) : b.risk_score - a.risk_score,
  );

  return { retention_rate: retentionRate, at_risk_members: atRiskMembers, summary };
}

function readNonNegativeInt(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AiOutputValidationError(`AI output field "${field}" must be a non-negative integer`);
  }
  return value;
}

function readStringArray(source: Record<string, unknown>, field: string): string[] {
  const value = source[field];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AiOutputValidationError(`AI output field "${field}" must be an array`);
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 200))
    .filter((item) => item !== '')
    .slice(0, 10);
}
