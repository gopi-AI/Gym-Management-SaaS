/**
 * Structured report query definition (docs/phase6-scoping-plan.md §3.1.1).
 *
 * This is DATA, not SQL. `ReportExecutorService` compiles it into a parameterised
 * query, which is what allows the executor to:
 *   - validate every referenced column against the source entity's metadata
 *     (§10 — the check that makes a catalog row executable or not), and
 *   - inject `organization_id = :orgId` tenant scoping automatically, because a
 *     single declared `source` gives it exactly one table to scope (§3.1.1).
 *
 * Stored as the `query_definition` jsonb column of `"REPORTS_REPORT_SCHEMAS"`.
 *
 * **RESOLVED — `columns` accepts three shapes, and no raw SQL** (§3.1.1, :240):
 * the §17 examples used to place raw SQL *expressions* in `columns` — `"COUNT(*)"`,
 * `"SUM(total_amount)"`, a date-truncation expression — which cannot be checked
 * against a column allowlist. The decision is that a `columns` value is a
 * `ColumnRef` (below): a plain column, an allowlisted aggregate over a column, or a
 * time bucket over a date column. Every identifier is validated against entity
 * metadata, and every function and bucket unit comes from a closed set, so the
 * guarantee stated above holds in full rather than for a subset. §17's examples were
 * rewritten to this shape.
 *
 * **Derived scalars are not expressions** (`rate`, `pct`, `days_overdue`,
 * `tenure_months`, `ww_change`, `avg_gap`): none is a column on any entity, and none
 * is an executor concern. A definition declares their *inputs* and the read layer
 * derives them — the pattern P6-24 set for `plan_name` and P6-28 for §6.7's `rate`.
 * Adding arithmetic here would reopen the hole the allowlist exists to close.
 */
/**
 * The only aggregate functions the executor will compile. A closed set, so a
 * `columns` value can never introduce a function the allowlist does not name.
 */
export type AggregateFunction = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

/**
 * The only time buckets the executor will compile, each mapped to a fixed
 * `date_trunc` unit. Also a closed set — the unit is never interpolated.
 */
export type TimeBucketUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * What a `columns` value may be — never a raw SQL fragment.
 *
 * Each variant is validated against the source entity's metadata *before* anything
 * is compiled, which is what keeps §3.1.1's allowlist guarantee true:
 *
 *   - **plain column** — `"total_amount"`
 *   - **aggregate** — `{ fn: 'SUM', column: 'total_amount' }`, optionally
 *     `distinct: true` (e.g. §6.7's `COUNT(DISTINCT account_id)`). `column` may be
 *     `'*'` only for `COUNT`, and only `COUNT` accepts `'*'`.
 *   - **time bucket** — `{ bucket: 'created_at', unit: 'month' }`, compiled to
 *     `date_trunc('<unit>', "created_at")`. This variant is load-bearing, not
 *     decorative: §6.x's `period`, `week` and `month` grouping keys are buckets, and
 *     **no entity carries any of those names as a column**, so an aggregates-only
 *     allowlist could not execute the twelve catalog rows that group by one.
 */
export type ColumnRef =
  | string
  | { fn: AggregateFunction; column: string | '*'; distinct?: boolean }
  | { bucket: string; unit: TimeBucketUnit };

export interface QueryDefinition {
  /** The primary data source entity. Resolved against entity metadata. */
  source: string;

  /** Column selections: `{ alias: ColumnRef }` — a column, an aggregate, or a bucket. */
  columns: Record<string, ColumnRef>;

  /** WHERE conditions, compiled to parameterised fragments. */
  filters?: readonly FilterClause[];

  /**
   * GROUP BY columns. Each entry resolves against **output aliases first**, then
   * source columns — the same rule as `order_by`, and for the same reason: §17 groups
   * by a bucketed alias (`"month"`) that is not a source column. A bucketed alias is
   * substituted by the expression it names, so `group_by: ["month"]` groups by
   * `date_trunc('month', "created_at")` rather than by the raw timestamp — grouping
   * by the underlying column would produce one row per timestamp, not per month.
   */
  group_by?: readonly string[];

  /**
   * ORDER BY clause. `column` resolves against **output aliases first**, then source
   * columns — §17's examples order by aliases (`"total"`, `"month"`), which are not
   * source columns, so alias-first is the reading that makes them valid.
   */
  order_by?: readonly { column: string; direction: 'ASC' | 'DESC' }[];

  /** LIMIT. */
  limit?: number;
}

/**
 * One WHERE condition (§3.1.1).
 *
 * `operator` is a closed union so the executor can compile each member to a
 * fixed fragment — the reason a filter can never be interpolated into SQL as raw
 * text.
 */
export interface FilterClause {
  /** Column the condition applies to (validated against the source allowlist). */
  column: string;

  /** Compiled to a parameterised fragment, never interpolated. */
  operator:
    | '='
    | '!='
    | '>'
    | '>='
    | '<'
    | '<='
    | 'BETWEEN'
    | 'IN'
    | 'NOT IN'
    | 'LIKE'
    | 'IS NULL'
    | 'IS NOT NULL';

  /**
   * Literal, list (for BETWEEN / IN), or a `$name` placeholder resolved from the
   * report parameters at execution time (e.g. `"$orgId"`, `"$from"`, `"$to"`).
   */
  value?: unknown | unknown[];
}
