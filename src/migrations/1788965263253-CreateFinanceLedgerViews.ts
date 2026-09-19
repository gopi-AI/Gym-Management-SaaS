import { MigrationInterface, QueryRunner } from 'typeorm';
import { FINANCE_LEDGER_VIEWS, sqlIdentifier } from '../finance/ledger.constants';
import {
  buildMemberOutstandingViewSql,
  buildOutstandingByStatusViewSql,
  buildRevenueByPeriodViewSql,
} from '../finance/ledger-views.constants';

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
 * The three `CREATE OR REPLACE VIEW` statements themselves are rendered by the
 * builders in `src/finance/ledger-views.constants.ts`, which also documents the
 * deliberate `COALESCE(..., 0.00)` two-decimal scale. Those builders live there
 * rather than beside this migration because `src/migrations/*{.ts,.js}` is loaded
 * wholesale by the TypeORM CLI and every exported *function* in it is mistaken
 * for a migration class — see that module's docblock and
 * `__specs__/migration-loader.contract.spec.ts`.
 */

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
    // P3-01-era rendering. These three definitions predate FINANCE_CREDIT_NOTES
    // and FINANCE_REFUNDS, and must NOT reference them: this migration sorts BELOW
    // 1788965263258, which creates those tables, so a reference here aborts
    // `migration:run` on a fresh database with
    //   relation "FINANCE_CREDIT_NOTES" does not exist
    // The credit-aware definitions arrive in a later migration
    // (1788965263259), which replaces these views in place.
    //
    // Do NOT drop this option to "modernise" the SQL: replaying a migration must
    // produce the statements it historically created. New view SQL goes behind a
    // new option and a new migration.
    const p301Era = { includeP302Terms: false };
    await queryRunner.query(buildMemberOutstandingViewSql(p301Era));
    await queryRunner.query(buildRevenueByPeriodViewSql(p301Era));
    await queryRunner.query(buildOutstandingByStatusViewSql(p301Era));
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
