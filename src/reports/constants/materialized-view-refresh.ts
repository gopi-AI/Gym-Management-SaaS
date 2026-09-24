/**
 * Refresh cadence and refresh guardrails for the reporting materialized views
 * (docs/phase6-scoping-plan.md §7.3, §7.4, §10).
 *
 * **Cadence lives here, permanently (P6-29 resolution (B)).** §7.4's "Where it
 * lives" table puts *which* views exist in `REPORTS_MATERIALIZED_VIEWS` rows and
 * *how often* each refreshes in code/config — the §7.3 schedule, the outbox
 * trigger wiring and the Redis debounce. `REPORTS_MATERIALIZED_VIEWS` is
 * `id, name, description, last_refreshed` and stays that shape; it gains no
 * cadence column. So the §7.3 table is translated here, keyed by the view's SQL
 * identifier — the same value §7.4 requires a registry row's `name` to equal.
 *
 * The worker resolves cadence **by name, with a default for any name not listed**.
 * That is deliberate: §7.4 makes registration "a migration + a row", so adding a
 * view must not require editing a second list, and a view that is registered
 * without a cadence entry refreshes on `DEFAULT_MATERIALIZED_VIEW_REFRESH_CADENCE_MS`
 * rather than never.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * §7.3's refresh frequencies, by view identifier.
 *
 *   | View                                  | §7.3 frequency            |
 *   |---------------------------------------|---------------------------|
 *   | reports_mv_daily_attendance           | Hourly (operating hours)  |
 *   | reports_mv_daily_revenue              | Every 6 hours (+ event)   |
 *   | reports_mv_membership_summary         | Every 6 hours             |
 *   | reports_mv_daily_workouts             | Hourly (+ on session log) |
 *   | reports_mv_member_churn_monthly       | Daily (off-peak)          |
 *   | reports_mv_membership_active_monthly  | Daily (off-peak)          |
 *
 * The "+ event" / "+ on session log" halves of §7.3 are the outbox-triggered,
 * debounced path — see `MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS` below. They
 * refine *when else* a view may refresh; they do not change its cron cadence.
 */
export const MATERIALIZED_VIEW_REFRESH_CADENCE_MS: Readonly<Record<string, number>> = {
  reports_mv_daily_attendance: HOUR_MS,
  reports_mv_daily_revenue: 6 * HOUR_MS,
  reports_mv_membership_summary: 6 * HOUR_MS,
  reports_mv_daily_workouts: HOUR_MS,
  reports_mv_member_churn_monthly: 24 * HOUR_MS,
  reports_mv_membership_active_monthly: 24 * HOUR_MS,
};

/**
 * Cadence for a registered view with no explicit entry above: the middle of the
 * range §7.3 uses (its "every 6 hours" tier). A registered view therefore always
 * refreshes on some cadence, which is what keeps §10's "retried on next cron
 * cycle" true for a view added by a migration without a code change here.
 */
export const DEFAULT_MATERIALIZED_VIEW_REFRESH_CADENCE_MS = 6 * HOUR_MS;

/**
 * §7.3's debounce window: at most one refresh per view per 5 minutes on the
 * outbox-triggered path ("**do not refresh per-event** — instead debounce to at
 * most once per 5 minutes using a Redis lock"). Enforced with a Redis key, which
 * is the same mechanism §7.4 names for it.
 */
export const MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS = 5 * MINUTE_MS;

/**
 * §10's failure rule: "Materialized view refresh fails → Logged, retried on next
 * cron cycle. **Alert after 3 consecutive failures**." Three is the threshold at
 * which a repeated failure stops being a transient database blip and becomes an
 * alertable condition.
 */
export const MATERIALIZED_VIEW_REFRESH_FAILURE_ALERT_THRESHOLD = 3;

/**
 * What may be interpolated into `REFRESH MATERIALIZED VIEW "<name>"`.
 *
 * `REFRESH MATERIALIZED VIEW` takes an **identifier**, not a bind parameter, so
 * the view name cannot be parameterised the way the executor parameterises its
 * filters — the name has to be interpolated. That makes this guard the security
 * control for the statement, in the same spirit as §3.1.1's column allowlist:
 * the name is *validated* rather than trusted.
 *
 * The name is never client-supplied — §4.3 addresses the registry row by `id`
 * and the SQL identifier is read from that row (§7.4), so a caller cannot reach
 * this with arbitrary text. The guard exists because the registry row is the
 * only thing standing between a request and an interpolated identifier, and a
 * row written wrongly (or by a future migration) must fail loudly rather than
 * reach the database as SQL.
 *
 * The pattern admits unquoted PostgreSQL identifier syntax only — a leading
 * letter or underscore followed by letters, digits or underscores, which is what
 * every view in §7.2 uses. A name containing a double quote, a semicolon or a
 * space is refused before any statement is built.
 */
export const MATERIALIZED_VIEW_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Longest name `REPORTS_MATERIALIZED_VIEWS.name` can hold (§3.3: varchar(200)). */
export const MATERIALIZED_VIEW_NAME_MAX_LENGTH = 200;

/** Is this name safe to interpolate as a quoted SQL identifier? */
export function isRefreshableMaterializedViewName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MATERIALIZED_VIEW_NAME_MAX_LENGTH &&
    MATERIALIZED_VIEW_IDENTIFIER_PATTERN.test(name)
  );
}