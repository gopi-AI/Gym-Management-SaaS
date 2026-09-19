import {
  FINANCE_LEDGER_VIEWS,
  SQL_DAYS_OVERDUE,
  SQL_ISSUED_CREDIT_NOTE,
  SQL_OUTSTANDING_STATUSES,
  SQL_SUCCEEDED_PAYMENT,
  SQL_SUCCEEDED_REFUND,
  sqlAgeingBucketCase,
  sqlIdentifier,
} from './ledger.constants';

/**
 * P3-01 Finance ledger read model — the view DDL builders (migration 1788965263253).
 *
 * These three functions render the `CREATE OR REPLACE VIEW` statements the
 * migration executes. They live here, in `src/finance/`, and deliberately NOT
 * next to the migration in `src/migrations/`:
 *
 *   `src/migrations/*{.ts,.js}` is loaded wholesale by the TypeORM CLI
 *   (`src/data-source.ts`, and the same glob in `app.module.ts`), and the loader
 *   (`DirectoryExportedClassesLoader.loadFileClasses`) collects **every exported
 *   function** it finds onto the migration list. `MigrationExecutor` then demands
 *   a 13-digit JavaScript timestamp suffix on each entry's name and aborts with
 *   `"... migration name is wrong. Migration class name should have a JavaScript
 *   timestamp appended."` for anything else. So an exported helper in that
 *   directory does not merely pollute the list — it makes `migration:run` and
 *   `migration:revert` fail outright, for every migration, in every environment.
 *
 *   `export const` is safe, which is why the `*_PERMISSIONS` arrays declared by
 *   the other migrations are fine: the loader recurses through arrays and plain
 *   objects and only ever pushes functions. Only function exports are a hazard.
 *
 * `src/migrations/__specs__/migration-loader.contract.spec.ts` pins that rule.
 *
 * The SQL is generated from the shared constants in `ledger.constants.ts` rather
 * than re-typed, so the view definitions cannot drift from the invoice status
 * machine, the succeeded-payment status and the ageing buckets that the write
 * paths and the API use.
 */
export interface LedgerViewSqlOptions {
  /**
   * Include the P3-02 terms: issued credit notes subtracted in both outstanding
   * views, and succeeded refunds netted off revenue.
   *
   * Defaults to `true` — the current definition, which is what a NEW migration
   * should render. Migration 1788965263253 passes `false`: it created the
   * payments-only views and must keep rendering exactly those.
   */
  includeP302Terms?: boolean;
}

/**
 * ## The append-only rule for these builders
 *
 * Several migrations render their DDL from these builders, and a migration is
 * supposed to replay as the statements it historically created. That makes the
 * builders **append-only in effect**:
 *
 *   **Never edit a builder so that an EXISTING migration's output changes.**
 *   New SQL goes behind a new option, and only a NEW migration may pass it.
 *
 * Editing what a shipped migration renders silently rewrites history, and it bit
 * us concretely. P3-02 added credit-note and refund terms to these builders,
 * which made migration 1788965263253 — which sorts BELOW 1788965263258, the
 * migration that creates those tables — emit SQL referencing
 * `FINANCE_CREDIT_NOTES`. `migration:run` on a FRESH database then aborted at
 * 253 with:
 *
 *   `Failed, error: relation "FINANCE_CREDIT_NOTES" does not exist`
 *
 * breaking every new environment (CI, staging, provisioning) while leaving
 * existing databases — where 253 never re-runs — perfectly healthy. The unit
 * tests could not catch it: they assert emitted SQL strings via a recording
 * QueryRunner and never execute anything.
 *
 * The inverse hazard is just as real: a NEWER term must never be rendered by an
 * OLDER migration, because the objects it references may not exist yet at that
 * point in the timeline.
 *
 * So when a view needs to change: add an option here, thread it through the
 * builder, and write a NEW `CREATE OR REPLACE VIEW` migration that passes it.
 * Leave every existing migration's call site alone, except to pin the era it
 * belongs to as 1788965263253 now does.
 */

/**
 * Succeeded payments totalled per invoice, as an inline derived table.
 *
 * `FINANCE_PAYMENTS` is the single source of truth for money received, so the
 * paid amount is summed here rather than read from a denormalised column. The
 * organization is carried through (and matched on in the join) so a payment can
 * never contribute to another tenant's figure even if a cross-tenant row were
 * somehow inserted.
 */
function paidAmountsPerInvoice(alias: string): string {
  return `(
                SELECT p."organization_id" AS organization_id,
                       p."invoice_id"      AS invoice_id,
                       SUM(p."amount")     AS paid_amount
                FROM "FINANCE_PAYMENTS" p
                WHERE p."status" = ${SQL_SUCCEEDED_PAYMENT}
                GROUP BY p."organization_id", p."invoice_id"
            ) ${alias}`;
}

/**
 * Issued credit notes totalled per invoice, as an inline derived table (P3-02).
 *
 * The counterpart of `paidAmountsPerInvoice`, and deliberately shaped the same
 * way: grouped by (`organization_id`, `invoice_id`) so it is exactly one row per
 * invoice. That matters because both derived tables are LEFT JOINed onto the same
 * invoice row — if either could produce more than one row per invoice the joins
 * would fan out and the money sums would silently multiply.
 *
 * `gross_amount` is the figure that reduces the balance: it is what the credit
 * note takes off the invoice, net and tax together. Only `issued` rows count —
 * see `SQL_ISSUED_CREDIT_NOTE`.
 */
function creditedAmountsPerInvoice(alias: string): string {
  return `(
                SELECT c."organization_id" AS organization_id,
                       c."invoice_id"      AS invoice_id,
                       SUM(c."gross_amount") AS credited_amount
                FROM "FINANCE_CREDIT_NOTES" c
                WHERE c."status" = ${SQL_ISSUED_CREDIT_NOTE}
                GROUP BY c."organization_id", c."invoice_id"
            ) ${alias}`;
}

/**
 * One detail that is easy to get wrong and is therefore deliberate: every
 * `COALESCE(..., 0.00)` fallback is written with two decimals. The type is not
 * the issue — `COALESCE(numeric, 0)` already resolves to `numeric` — but the
 * *scale* is: an integer `0` has scale 0, so a member or organization with no
 * succeeded payments would serialise `total_paid` as `"0"` while every other row
 * serialises `"0.00"`, i.e. the same field in two shapes. Writing the literal as
 * `0.00` keeps the scale at 2 so the column is consistent row to row.
 */

/**
 * `V_FINANCE_MEMBER_OUTSTANDING` — one row per (organization_id, member_id).
 *
 * `includeP302Terms: false` renders the view exactly as migration 1788965263253
 * created it, with no reference to `FINANCE_CREDIT_NOTES` — which does not exist
 * yet at that point in the migration sequence.
 */
export function buildMemberOutstandingViewSql(options: LedgerViewSqlOptions = {}): string {
  const includeP302Terms = options.includeP302Terms ?? true;

  const creditSub = includeP302Terms
    ? `
                    - COALESCE(SUM(c.credited_amount), 0.00)`
    : '';
  const creditColumn = includeP302Terms
    ? `,
            -- Appended LAST on purpose: CREATE OR REPLACE VIEW may only ADD
            -- columns at the end of the list (the existing ones must keep the same
            -- names, order and types). Slotting this in beside total_paid would
            -- fail on any database that already has the P3-01 view.
            COALESCE(SUM(c.credited_amount), 0.00)                                 AS total_credited`
    : '';
  const creditJoin = includeP302Terms
    ? `
        LEFT JOIN ${creditedAmountsPerInvoice('c')}
            ON c.invoice_id = i."id" AND c.organization_id = i."organization_id"`
    : '';

  return `
        CREATE OR REPLACE VIEW ${sqlIdentifier(FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING)} AS
        SELECT
            i."organization_id"                                                    AS organization_id,
            i."member_id"                                                          AS member_id,
            o."currency"                                                           AS currency,
            SUM(i."total_amount")                                                  AS total_invoiced,
            COALESCE(SUM(p.paid_amount), 0.00)                                     AS total_paid,
            GREATEST(
                SUM(i."total_amount")
                    - COALESCE(SUM(p.paid_amount), 0.00)${creditSub},
                0.00
            )                                                                      AS outstanding_balance,
            COUNT(*)                                                               AS invoice_count,
            MIN(i."due_date")                                                      AS oldest_due_date,
            GREATEST((CURRENT_DATE - MIN(i."due_date")::date), 0)                  AS days_overdue${creditColumn}
        FROM "FINANCE_INVOICES" i
        JOIN "TENANCY_ORGANIZATIONS" o ON o."id" = i."organization_id"
        LEFT JOIN ${paidAmountsPerInvoice('p')}
            ON p.invoice_id = i."id" AND p.organization_id = i."organization_id"${creditJoin}
        WHERE i."status" IN (${SQL_OUTSTANDING_STATUSES})
        GROUP BY i."organization_id", i."member_id", o."currency"
    `;
}


/**
 * `V_FINANCE_REVENUE_BY_PERIOD` — one row per (organization_id, branch_id, day).
 *
 * Day granularity is deliberate: the view stores the finest period the API
 * accepts, and `GET /v1/financial-reports/revenue-summary` rolls it up to the
 * requested `period` (`day` | `week` | `month`). Storing a single coarse period
 * would make the coarser choice irreversible.
 *
 * **Refunds ARE netted off (P3-02).** P3-01 built this view payments-only and
 * documented the omission as P3-02's to close ("Refunds are NOT netted off —
 * `FINANCE_REFUNDS` is P3-02"); that deferral is now discharged. §2's own table
 * classifies a refund as *"Debit revenue / credit cash"* — a revenue effect —
 * whereas a credit note is *"credit receivables"*, a balance effect. So refunds
 * belong here and credit notes belong in the outstanding views, and each is
 * netted in exactly one place.
 *
 * Consequence worth stating plainly: `revenue_amount` is NET revenue, so a day
 * that refunds more than it collects reports a **negative** figure. That is
 * arithmetically correct and is deliberately not clamped with `GREATEST` — hiding
 * a negative day would overstate revenue, which is the one direction a revenue
 * report must never err in.
 *
 * `payment_count` counts only payment entries. A refund is a reversal of an
 * earlier payment, not a second collection, so counting it would inflate the
 * number of payments taken.
 *
 * A refund carries no `branch_id` of its own (`FINANCE_REFUNDS` has no such
 * column — it attaches to a payment), so the branch is taken from the refunded
 * payment via a join. The organization is matched in that join as well as being
 * carried through, so a refund can never be attributed to another tenant's
 * branch even if a cross-tenant row were somehow inserted.
 */
export function buildRevenueByPeriodViewSql(options: LedgerViewSqlOptions = {}): string {
  const includeP302Terms = options.includeP302Terms ?? true;
  const view = sqlIdentifier(FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD);

  // The two shapes are written out in full rather than interleaved with template
  // fragments: the refund term changes the query STRUCTURE (a UNION ALL) rather
  // than adding a clause, and two readable statements beat one tangled one.
  if (!includeP302Terms) {
    // Exactly what migration 1788965263253 created. It must not mention
    // FINANCE_REFUNDS — that table does not exist yet at 253's point in the
    // sequence, so referencing it aborts `migration:run` on a fresh database.
    return `
        CREATE OR REPLACE VIEW ${view} AS
        SELECT
            p."organization_id"    AS organization_id,
            p."branch_id"          AS branch_id,
            o."currency"           AS currency,
            p."payment_date"::date AS period_start,
            COUNT(*)               AS payment_count,
            SUM(p."amount")        AS revenue_amount
        FROM "FINANCE_PAYMENTS" p
        JOIN "TENANCY_ORGANIZATIONS" o ON o."id" = p."organization_id"
        WHERE p."status" = ${SQL_SUCCEEDED_PAYMENT}
        GROUP BY p."organization_id", p."branch_id", o."currency", p."payment_date"::date
    `;
  }

  return `
        CREATE OR REPLACE VIEW ${view} AS
        SELECT
            e."organization_id"                                        AS organization_id,
            e."branch_id"                                              AS branch_id,
            e."currency"                                               AS currency,
            e."period_start"                                           AS period_start,
            SUM(CASE WHEN e."entry_type" = 'payment' THEN 1 ELSE 0 END) AS payment_count,
            SUM(e."signed_amount")                                     AS revenue_amount
        FROM (
            SELECT
                p."organization_id"    AS organization_id,
                p."branch_id"          AS branch_id,
                o."currency"           AS currency,
                p."payment_date"::date AS period_start,
                'payment'              AS entry_type,
                p."amount"             AS signed_amount
            FROM "FINANCE_PAYMENTS" p
            JOIN "TENANCY_ORGANIZATIONS" o ON o."id" = p."organization_id"
            WHERE p."status" = ${SQL_SUCCEEDED_PAYMENT}

            UNION ALL

            SELECT
                r."organization_id"     AS organization_id,
                pay."branch_id"         AS branch_id,
                o."currency"            AS currency,
                r."refund_date"::date   AS period_start,
                'refund'                AS entry_type,
                -r."amount"             AS signed_amount
            FROM "FINANCE_REFUNDS" r
            JOIN "FINANCE_PAYMENTS" pay
                ON pay."id" = r."payment_id" AND pay."organization_id" = r."organization_id"
            JOIN "TENANCY_ORGANIZATIONS" o ON o."id" = r."organization_id"
            WHERE r."status" = ${SQL_SUCCEEDED_REFUND}
        ) e
        GROUP BY e."organization_id", e."branch_id", e."currency", e."period_start"
    `;
}

/**
 * `V_FINANCE_OUTSTANDING_BY_STATUS` — one row per
 * (organization_id, status, ageing bucket).
 *
 * The bucket is evaluated per invoice in the inner query and only then grouped,
 * so the buckets partition the invoice population exactly (every invoice lands
 * in exactly one bucket) instead of being derived from an aggregate.
 *
 * No `currency` column: the report is scoped to one organization and adds
 * across every invoice it has, so a single currency would be misleading rather
 * than informative (see the service).
 */
export function buildOutstandingByStatusViewSql(options: LedgerViewSqlOptions = {}): string {
  const includeP302Terms = options.includeP302Terms ?? true;
  const bucketCase = sqlAgeingBucketCase(SQL_DAYS_OVERDUE);

  const creditSub = includeP302Terms
    ? `
                    - COALESCE(SUM(b.credited_amount), 0.00)`
    : '';
  const creditColumn = includeP302Terms
    ? `,
            -- Appended LAST: see the note on the member-outstanding view —
            -- CREATE OR REPLACE VIEW may only add columns at the end.
            COALESCE(SUM(b.credited_amount), 0.00)                        AS total_credited`
    : '';
  const creditInnerColumn = includeP302Terms
    ? `
                COALESCE(c.credited_amount, 0.00) AS credited_amount,`
    : '';
  const creditJoin = includeP302Terms
    ? `
            LEFT JOIN ${creditedAmountsPerInvoice('c')}
                ON c.invoice_id = i."id" AND c.organization_id = i."organization_id"`
    : '';

  return `
        CREATE OR REPLACE VIEW ${sqlIdentifier(FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS)} AS
        SELECT
            b.organization_id                                          AS organization_id,
            b."status"                                                 AS status,
            b.ageing_bucket                                            AS ageing_bucket,
            COUNT(*)                                                   AS invoice_count,
            SUM(b.total_amount)                                        AS total_invoiced,
            COALESCE(SUM(b.paid_amount), 0.00)                            AS total_paid,
            GREATEST(
                SUM(b.total_amount)
                    - COALESCE(SUM(b.paid_amount), 0.00)${creditSub},
                0.00
            )                                                          AS outstanding_balance${creditColumn}
        FROM (
            SELECT
                i."organization_id"          AS organization_id,
                i."status"                   AS "status",
                i."total_amount"             AS total_amount,
                COALESCE(p.paid_amount, 0.00) AS paid_amount,${creditInnerColumn}
                ${bucketCase} AS ageing_bucket
            FROM "FINANCE_INVOICES" i
            LEFT JOIN ${paidAmountsPerInvoice('p')}
                ON p.invoice_id = i."id" AND p.organization_id = i."organization_id"${creditJoin}
            WHERE i."status" IN (${SQL_OUTSTANDING_STATUSES})
        ) b
        GROUP BY b.organization_id, b."status", b.ageing_bucket
    `;
}

