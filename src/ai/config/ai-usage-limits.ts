/**
 * AI usage-limit configuration: defaults, bounded parsing, window arithmetic
 * and Redis key construction.
 *
 * Everything here is deliberately pure so the enforcement service
 * (`AiUsageLimitService`) stays thin and the key/window rules are unit-testable
 * without Redis or a database.
 *
 * Limit semantics (mirrored in `.env.example`):
 * - `0` explicitly DISABLES the corresponding limit (the repository already uses
 *   `0` in the same "disabled / no default" sense for `REDIS_TTL`);
 * - a missing or unparsable value falls back to the documented default, so an
 *   enabled AI deployment is never accidentally unlimited;
 * - every limit is bounded by a hard maximum so a typo cannot disable the guard.
 */

export const DEFAULT_AI_RATE_LIMIT_RPM = 20;
export const DEFAULT_AI_RATE_LIMIT_TPD = 200_000;
export const DEFAULT_AI_COST_LIMIT_MONTHLY_USD = 25;

export const AI_RATE_LIMIT_MAX_RPM = 10_000;
export const AI_RATE_LIMIT_MAX_TPD = 100_000_000;
export const AI_COST_LIMIT_MAX_MONTHLY_USD = 1_000_000;

/** Fixed window for the per-user/per-organization/per-request-type counter. */
export const AI_RATE_LIMIT_WINDOW_SECONDS = 60;

/** Redis key namespaces. Both keys are always organization-scoped. */
export const AI_RATE_LIMIT_KEY_PREFIX = 'ai:ratelimit';
export const AI_DAILY_TOKEN_BUDGET_KEY_PREFIX = 'ai:budget';
export const AI_MONTHLY_COST_BUDGET_KEY_PREFIX = 'ai:cost';

const MS_PER_DAY = 86_400_000;

export interface AiUsageLimits {
  /** Requests per minute for one (organization, user, request type) tuple. */
  requestsPerMinute: number;
  /** Provider-reported tokens per UTC day for one organization. */
  tokensPerDay: number;
  /** Estimated USD per UTC month for one organization. */
  monthlyCostUsd: number;
}

/** A description of the current (UTC) time window backing a budget counter. */
export interface TimeWindow {
  /** Inclusive lower bound. */
  start: Date;
  /** Exclusive upper bound. */
  end: Date;
}

/**
 * Parses a configuration value into a bounded usage limit.
 *
 * Deliberately not "fail open": an unparsable value yields `fallback`, never
 * `Infinity`, and `0` is only returned when the operator explicitly wrote `0`.
 */
export function resolveAiLimit(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const parsed = Number(String(raw).trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Redis keys may not contain separators or whitespace coming from dynamic
 * values. Organization/user ids are UUIDs and request types are server
 * constants, but every segment is sanitized defensively so a malformed value
 * can never forge another tenant's key.
 */
export function sanitizeKeySegment(value: string): string {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 100);
}

/**
 * `ai:ratelimit:{organizationId}:{userId}:{requestType}`
 *
 * The authorized organization and the authenticated user are both part of the
 * key, so counters cannot be shared across tenants, across users within a
 * tenant, or across request types.
 */
export function buildRateLimitKey(
  organizationId: string,
  userId: string,
  requestType: string,
): string {
  return [
    AI_RATE_LIMIT_KEY_PREFIX,
    sanitizeKeySegment(organizationId),
    sanitizeKeySegment(userId),
    sanitizeKeySegment(requestType),
  ].join(':');
}

/** `ai:budget:{organizationId}:{YYYY-MM-DD}` — per organization, per UTC day. */
export function buildDailyTokenBudgetKey(organizationId: string, date: string): string {
  return [
    AI_DAILY_TOKEN_BUDGET_KEY_PREFIX,
    sanitizeKeySegment(organizationId),
    sanitizeKeySegment(date),
  ].join(':');
}

/** `ai:cost:{organizationId}:{YYYY-MM}` — per organization, per UTC month. */
export function buildMonthlyCostBudgetKey(organizationId: string, month: string): string {
  return [
    AI_MONTHLY_COST_BUDGET_KEY_PREFIX,
    sanitizeKeySegment(organizationId),
    sanitizeKeySegment(month),
  ].join(':');
}

/** Deterministic UTC calendar day label (`YYYY-MM-DD`). */
export function utcDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Deterministic UTC calendar month label (`YYYY-MM`). */
export function utcMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

/** `[start, end)` bounds of the UTC calendar day containing `date`. */
export function utcDayBounds(date: Date): TimeWindow {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}

/** `[start, end)` bounds of the UTC calendar month containing `date`. */
export function utcMonthBounds(date: Date): TimeWindow {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)) };
}

/** Whole seconds from `now` until `end`, never below 1 (Redis needs a positive TTL). */
export function secondsUntil(end: Date, now: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000));
}

/** Coerces a Redis/SQL counter value into a finite, non-negative number. */
export function toCounterNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
