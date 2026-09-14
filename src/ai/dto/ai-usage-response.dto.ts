/**
 * Operator-facing AI usage / cost contract.
 *
 * Scope rules (deliberate):
 * - Every figure is an AGGREGATE for ONE authorized organization, computed from
 *   the durable `AI_USAGE` ledger (`organization_id`, `total_tokens`,
 *   `estimated_cost_usd`, `created_at`).
 * - `organization_id` and `generated_at` are set by the SERVER from the
 *   authorized tenant context — never from client input.
 * - No prompt, model response, API key, token, user identity or member identity
 *   is exposed: only counts, token totals and server-computed cost.
 */

/** Aggregates for one UTC window (a calendar day or a calendar month). */
export interface AiUsageWindowDto {
  /** `YYYY-MM-DD` (day) or `YYYY-MM` (month), UTC. */
  label: string;
  requests: number;
  failed_requests: number;
  total_tokens: number;
  /** Server-computed from `AI_USAGE.estimated_cost_usd`; 0 when unpriced. */
  estimated_cost_usd: number;
}

/** The limits actually enforced by `AiUsageLimitService` (0 = disabled). */
export interface AiUsageLimitsDto {
  /** Requests per minute for one (organization, user, request type) tuple. */
  rate_limit_requests_per_minute: number;
  /** Length of the fixed rate-limit window, in seconds. */
  rate_limit_window_seconds: number;
  /** Provider-reported tokens per UTC day for the organization. */
  daily_token_limit: number;
  /** Estimated USD per UTC month for the organization. */
  monthly_cost_limit_usd: number;
}

/** Per-use-case breakdown for the current UTC month. */
export interface AiUsageRequestTypeDto {
  /** Server-owned request type, e.g. `retention-analysis`. */
  request_type: string;
  requests: number;
  failed_requests: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

/** Budget consumption. `*_remaining` is null when the limit is disabled. */
export interface AiUsageQuotaDto {
  tokens_used_today: number;
  token_limit_per_day: number;
  tokens_remaining_today: number | null;
  cost_used_this_month_usd: number;
  cost_limit_per_month_usd: number;
  cost_remaining_this_month_usd: number | null;
}

export interface AiUsageResponseDto {
  organization_id: string;
  generated_at: string;
  /** Global AI kill-switch (`AI_ENABLED`) as seen by this process. */
  ai_enabled: boolean;
  day: AiUsageWindowDto;
  month: AiUsageWindowDto;
  quota: AiUsageQuotaDto;
  limits: AiUsageLimitsDto;
  by_request_type: AiUsageRequestTypeDto[];
}
