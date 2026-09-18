import {
  FINANCE_LEDGER_VIEWS,
  SQL_DAYS_OVERDUE,
  SQL_OUTSTANDING_STATUSES,
  SQL_SUCCEEDED_PAYMENT,
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
 * paths and the API use. Replaying migration 1788965263253 always renders these
 * constants as they are in the code being run, so if either constant changes, a
 * **new** `CREATE OR REPLACE VIEW` migration must follow.
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
 * One detail that is easy to get wrong and is therefore deliberate: every
 * `COALESCE(..., 0.00)` fallback is written with two decimals. The type is not
 * the issue — `COALESCE(numeric, 0)` already resolves to `numeric` — but the
 * *scale* is: an integer `0` has scale 0, so a member or organization with no
 * succeeded payments would serialise `total_paid` as `"0"` while every other row
 * serialises `"0.00"`, i.e. the same field in two shapes. Writing the literal as
 * `0.00` keeps the scale at 2 so the column is consistent row to row.
 */

/** `V_FINANCE_MEMBER_OUTSTANDING` — one row per (organization_id, member_id). */
export function buildMemberOutstandingViewSql(): string {
  return `
        CREATE OR REPLACE VIEW ${sqlIdentifier(FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING)} AS
        SELECT
            i."organization_id"                                                    AS organization_id,
            i."member_id"                                                          AS member_id,
            o."currency"                                                           AS currency,
            SUM(i."total_amount")                                                  AS total_invoiced,
            COALESCE(SUM(p.paid_amount), 0.00)                                     AS total_paid,
            GREATEST(SUM(i."total_amount") - COALESCE(SUM(p.paid_amount), 0.00), 0.00) AS outstanding_balance,
            COUNT(*)                                                               AS invoice_count,
            MIN(i."due_date")                                                      AS oldest_due_date,
            GREATEST((CURRENT_DATE - MIN(i."due_date")::date), 0)                  AS days_overdue
        FROM "FINANCE_INVOICES" i
        JOIN "TENANCY_ORGANIZATIONS" o ON o."id" = i."organization_id"
        LEFT JOIN ${paidAmountsPerInvoice('p')}
            ON p.invoice_id = i."id" AND p.organization_id = i."organization_id"
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
 * Refunds are NOT netted off — `FINANCE_REFUNDS` is P3-02 (see the migration
 * docblock), so zero rows would be joined.
 */
export function buildRevenueByPeriodViewSql(): string {
  return `
        CREATE OR REPLACE VIEW ${sqlIdentifier(FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD)} AS
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
export function buildOutstandingByStatusViewSql(): string {
  const bucketCase = sqlAgeingBucketCase(SQL_DAYS_OVERDUE);
  return `
        CREATE OR REPLACE VIEW ${sqlIdentifier(FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS)} AS
        SELECT
            b.organization_id                                          AS organization_id,
            b."status"                                                 AS status,
            b.ageing_bucket                                            AS ageing_bucket,
            COUNT(*)                                                   AS invoice_count,
            SUM(b.total_amount)                                        AS total_invoiced,
            COALESCE(SUM(b.paid_amount), 0.00)                            AS total_paid,
            GREATEST(SUM(b.total_amount) - COALESCE(SUM(b.paid_amount), 0.00), 0.00) AS outstanding_balance
        FROM (
            SELECT
                i."organization_id"          AS organization_id,
                i."status"                   AS "status",
                i."total_amount"             AS total_amount,
                COALESCE(p.paid_amount, 0.00) AS paid_amount,
                ${bucketCase} AS ageing_bucket
            FROM "FINANCE_INVOICES" i
            LEFT JOIN ${paidAmountsPerInvoice('p')}
                ON p.invoice_id = i."id" AND p.organization_id = i."organization_id"
            WHERE i."status" IN (${SQL_OUTSTANDING_STATUSES})
        ) b
        GROUP BY b.organization_id, b."status", b.ageing_bucket
    `;
}

