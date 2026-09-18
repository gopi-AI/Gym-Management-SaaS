import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  FINANCE_LEDGER_VIEWS,
  SQL_DAYS_OVERDUE,
  SQL_OUTSTANDING_STATUSES,
  SQL_SUCCEEDED_PAYMENT,
  sqlAgeingBucketCase,
  sqlIdentifier,
} from '../finance/ledger.constants';

/**
 * Phase 3 — Finance ledger read model (P3-01, `docs/phase3-scoping-plan.md` §1).
 *
 * Creates three **plain (non-materialized) views** and one supporting index on
 * the base table. No table, column or entity is added: the views are pure
 * derivations of `FINANCE_INVOICES` and `FINANCE_PAYMENTS`, which stay the
 * single source of truth, so a ledger figure can never drift from the
 * transactions behind it.
 *
 *   V_FINANCE_MEMBER_OUTSTANDING    per (organization_id, member_id) balance
 *   V_FINANCE_REVENUE_BY_PERIOD     per (organization_id, branch_id, day) revenue
 *   V_FINANCE_OUTSTANDING_BY_STATUS per (organization_id, status, ageing bucket)
 *
 * Deviations from §1, all deliberate:
 *   - **Plain views, not materialized.** §1's recommended default was
 *     materialized views for the two reporting objects. The approved decision is
 *     plain views for all three, so `MV_*` became `V_*`. Consequence: a plain
 *     view cannot carry an index, so the access path has to live on the base
 *     tables — hence the composite index added below. A second, useful
 *     consequence is that `CURRENT_DATE`/`now()` inside the ageing expression is
 *     evaluated per query rather than frozen at the last refresh.
 *   - **No credit-note or refund term.** §1's definition of the member balance
 *     subtracts "applied credit notes", and its revenue view nets off refunds.
 *     Neither table exists: `FINANCE_CREDIT_NOTES` / `FINANCE_REFUNDS` are
 *     P3-02, sequenced after P3-01. Both terms are omitted here and land as a
 *     follow-up migration when P3-02 ships, rather than being faked against
 *     columns that do not exist.
 *   - **`organization_id` and `currency` are view outputs.** §1 flags that the
 *     ERD's ledger table carries neither. Both views that expose money therefore
 *     publish `organization_id` as a grouping key and `currency` joined from
 *     `TENANCY_ORGANIZATIONS`, the only place a currency is recorded. No column
 *     is added to any table to achieve this.
 *   - **No `reporting` schema.** The views are created in the same schema as the
 *     finance tables, so no new namespace is introduced.
 *
 * The status list and the ageing-bucket boundaries are NOT re-typed in SQL: the
 * `IN (...)` list comes from `OUTSTANDING_INVOICE_STATUSES` and the bucket `CASE`
 * is generated from `AGEING_BUCKETS` (both in `src/finance/ledger.constants.ts`),
 * which is what §1 requires of the status list. The trade-off is that the view
 * DDL is derived from code constants, so if either constant ever changes, a
 * **new** `CREATE OR REPLACE VIEW` migration must follow — replaying this
 * migration always renders the constants as they are in the code being run.
 * `__specs__/1788965263253-CreateFinanceLedgerViews.spec.ts` pins that lockstep.
 *
 * Reversible: `down` drops the views and the index. Views hold no data, so no
 * data can be lost.
 *
 * One detail that is easy to get wrong and is therefore deliberate: every
 * `COALESCE(..., 0.00)` fallback is written with two decimals. The type is not
 * the issue — `COALESCE(numeric, 0)` already resolves to `numeric` — but the
 * *scale* is: an integer `0` has scale 0, so a member or organization with no
 * succeeded payments would serialise `total_paid` as `"0"` while every other row
 * serialises `"0.00"`, i.e. the same field in two shapes. Writing the literal as
 * `0.00` keeps the scale at 2 so the column is consistent row to row.
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

export class CreateFinanceLedgerViews1788965263253 implements MigrationInterface {
  name = 'CreateFinanceLedgerViews1788965263253';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Supporting index for the member-balance and by-status access paths. A
    // plain view is not indexable, so this composite index on the base table is
    // what the views' GROUP BY / WHERE clauses use.
    await queryRunner.query(`
            CREATE INDEX "IDX_finance_invoices_org_member_status"
            ON "FINANCE_INVOICES" ("organization_id", "member_id", "status")
        `);
    await queryRunner.query(buildMemberOutstandingViewSql());
    await queryRunner.query(buildRevenueByPeriodViewSql());
    await queryRunner.query(buildOutstandingByStatusViewSql());
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse creation order (no view depends on another, but the order is kept
    // symmetric with `up` so the intent is obvious).
    await queryRunner.query(
      `DROP VIEW IF EXISTS ${sqlIdentifier(FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS)}`,
    );
    await queryRunner.query(
      `DROP VIEW IF EXISTS ${sqlIdentifier(FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD)}`,
    );
    await queryRunner.query(
      `DROP VIEW IF EXISTS ${sqlIdentifier(FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING)}`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_finance_invoices_org_member_status"`);
  }
}
