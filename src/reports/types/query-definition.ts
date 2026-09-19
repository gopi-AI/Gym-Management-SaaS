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
 * **Known open contradiction, deliberately not resolved here** (§3.1.1, :240):
 * the §17 examples place raw SQL *expressions* in `columns` — `"COUNT(*)"`,
 * `"SUM(total_amount)"`, a date-truncation expression. Arbitrary expressions
 * cannot be checked against a column allowlist, so the safety guarantee above
 * holds only for plain column references and a fixed set of allowlisted
 * aggregates. Either the executor restricts `columns` to that subset (and §17's
 * examples are rewritten), or the guarantee is explicitly weakened. This type
 * records the structure as written; it does not encode which of the two will win,
 * because that decision is still open.
 */
export interface QueryDefinition {
  /** The primary data source entity. Resolved against entity metadata. */
  source: string;

  /** Column selections: `{ alias: "source_column" or aggregate }`. */
  columns: Record<string, string>;

  /** WHERE conditions, compiled to parameterised fragments. */
  filters?: FilterClause[];

  /** GROUP BY columns. */
  group_by?: string[];

  /** ORDER BY clause. */
  order_by?: { column: string; direction: 'ASC' | 'DESC' }[];

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
