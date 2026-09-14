import {
  AiOutputValidationError,
  isPlainObject,
  readNumber,
  readString,
} from './ai-output-validation';
import {
  PLAN_PERFORMANCE_MAX_RECOMMENDATIONS,
  PLAN_PERFORMANCE_MAX_SUMMARY_LENGTH,
} from '../prompts/plan-performance.prompt';

/**
 * Re-exported so consumers of this contract keep a single import path; the
 * class itself stays owned by the shared AI error taxonomy (no duplicate class).
 */
export { AiOutputValidationError } from './ai-output-validation';

/** Qualitative priority a plan recommendation can carry. */
export const PLAN_PERFORMANCE_PRIORITIES = ['high', 'medium', 'low'] as const;
export type PlanPerformancePriority = (typeof PLAN_PERFORMANCE_PRIORITIES)[number];

/** Lifecycle transitions observed for one plan inside the analysis window. */
export interface PlanPerformanceLifecycleDto {
  transition: string;
  count: number;
}

/**
 * Server-computed performance metrics for one plan.
 *
 * Every number here is derived by the SERVER from organization-scoped rows; the
 * model never supplies or overrides them.
 */
export interface PlanPerformancePlanDto {
  plan_id: string;
  name: string;
  price: number;
  currency: string;
  billing_period: string;
  duration_days: number;
  trial_days: number;
  is_active: boolean;
  total_memberships: number;
  active_memberships: number;
  paused_or_frozen_memberships: number;
  cancelled_memberships: number;
  /** cancelled / total memberships for this plan, in [0, 1]. */
  churn_rate: number;
  /** Average realized membership length in days, or null when unmeasurable. */
  average_realized_days: number | null;
  /** Memberships that started below the plan's current price. */
  discounted_signups: number;
  /** Current price vs. the average signup price, in percent, or null. */
  price_change_percent: number | null;
  lifecycle_transitions: PlanPerformanceLifecycleDto[];
}

/** Model-ranked advice for one plan. `name` is always taken from the server dataset. */
export interface PlanPerformanceRecommendationDto {
  plan_id: string;
  name: string;
  priority: PlanPerformancePriority;
  issue: string;
  recommended_action: string;
}

/**
 * Public API response.
 *
 * `organization_id`, `period`, the plan metrics and `generated_at` are set by
 * the server (never by the model) so the tenant identity and the business
 * figures of a response can never be spoofed.
 */
export interface PlanPerformanceResponseDto {
  organization_id: string;
  period: string;
  total_plans: number;
  analyzed_plans: number;
  total_memberships: number;
  active_memberships: number;
  overall_churn_rate: number;
  /** Model assessment of portfolio health, in [0, 1]. */
  portfolio_health: number;
  plans: PlanPerformancePlanDto[];
  recommendations: PlanPerformanceRecommendationDto[];
  summary: string;
  generated_at: string;
}

/** Normalized, validated subset of the model output. */
export interface ValidatedPlanPerformanceModelOutput {
  portfolio_health: number;
  recommendations: PlanPerformanceRecommendationDto[];
  summary: string;
}

/**
 * Strict validator/sanitizer for the model's structured output.
 *
 * Threat model (mirrors `validateRetentionModelOutput`):
 * - the model output is UNTRUSTED;
 * - it must never be able to surface a plan outside the authorized,
 *   organization-scoped dataset, so unknown plan ids are dropped rather than
 *   rejected (defence in depth) and the plan name always comes from the
 *   server-side dataset;
 * - it must never be able to smuggle a priority the UI does not know, so an
 *   unknown priority fails closed;
 * - structural violations (wrong types, out-of-range numbers, missing required
 *   fields) fail closed with {@link AiOutputValidationError}.
 */
export function validatePlanPerformanceModelOutput(
  raw: unknown,
  authorizedPlans: ReadonlyMap<string, string>,
): ValidatedPlanPerformanceModelOutput {
  if (!isPlainObject(raw)) {
    throw new AiOutputValidationError('AI output is not a JSON object');
  }

  const portfolioHealth = readNumber(raw, 'portfolio_health', 0, 1);
  const summary = readString(raw, 'summary', PLAN_PERFORMANCE_MAX_SUMMARY_LENGTH);

  const rawRecommendations = raw.recommendations;
  if (rawRecommendations !== undefined && !Array.isArray(rawRecommendations)) {
    throw new AiOutputValidationError('AI output field "recommendations" must be an array');
  }

  const seen = new Set<string>();
  const recommendations: PlanPerformanceRecommendationDto[] = [];

  for (const entry of (rawRecommendations ?? []) as unknown[]) {
    if (!isPlainObject(entry)) {
      throw new AiOutputValidationError('AI output "recommendations" entries must be objects');
    }
    const planId = entry.plan_id;
    if (typeof planId !== 'string' || planId.trim() === '') {
      throw new AiOutputValidationError('AI output recommendation is missing a string plan_id');
    }
    // Tenant containment: anything outside the authorized dataset is discarded.
    const authorizedName = authorizedPlans.get(planId);
    if (authorizedName === undefined || seen.has(planId)) {
      continue;
    }
    seen.add(planId);

    recommendations.push({
      plan_id: planId,
      // Name is always taken from the authorized dataset, never from the model.
      name: authorizedName,
      priority: readPriority(entry, 'priority'),
      issue: readString(entry, 'issue', 200),
      recommended_action: readString(entry, 'recommended_action', 500),
    });

    if (recommendations.length >= PLAN_PERFORMANCE_MAX_RECOMMENDATIONS) {
      break;
    }
  }

  const priorityRank: Record<PlanPerformancePriority, number> = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) =>
    a.priority === b.priority
      ? a.plan_id.localeCompare(b.plan_id)
      : priorityRank[a.priority] - priorityRank[b.priority],
  );

  return { portfolio_health: portfolioHealth, recommendations, summary };
}

function readPriority(source: Record<string, unknown>, field: string): PlanPerformancePriority {
  const value = source[field];
  if (
    typeof value !== 'string' ||
    !(PLAN_PERFORMANCE_PRIORITIES as readonly string[]).includes(value)
  ) {
    throw new AiOutputValidationError(
      `AI output field "${field}" must be one of: ${PLAN_PERFORMANCE_PRIORITIES.join(', ')}`,
    );
  }
  return value as PlanPerformancePriority;
}
