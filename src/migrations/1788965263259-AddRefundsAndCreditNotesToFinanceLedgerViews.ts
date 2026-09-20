import { MigrationInterface, QueryRunner } from 'typeorm';
import { FINANCE_LEDGER_VIEWS, sqlIdentifier } from '../finance/ledger.constants';
import {
  buildMemberOutstandingViewSql,
  buildOutstandingByStatusViewSql,
  buildRevenueByPeriodViewSql,
} from '../finance/ledger-views.constants';

/**
 * Phase 3 / P3-02 — add refund and credit-note terms to the finance ledger views.
 *
 * This is the **follow-up migration migration 1788965263253 explicitly
 * anticipated**. That migration's own docblock says: *"§1's definition of the
 * member balance subtracts 'applied credit notes', and its revenue view nets off
 * refunds. Neither table exists: `FINANCE_CREDIT_NOTES` / `FINANCE_REFUNDS` are
 * P3-02, sequenced after P3-01. Both terms are omitted here and land as a
 * follow-up migration when P3-02 ships, rather than being faked against columns
 * that do not exist."* P3-02 has now shipped (migration 1788965263258), so the
 * terms land here.
 *
 * Why a new migration rather than editing 253: `up()` renders the view DDL from
 * the builders in `src/finance/ledger-views.constants.ts`, so editing those
 * builders does **not** change a view that already exists in a deployed database.
 * Re-running `CREATE OR REPLACE VIEW` is what actually applies the change.
 *
 * What changes, and why each formula changes the way it does:
 *   - `V_FINANCE_MEMBER_OUTSTANDING` and `V_FINANCE_OUTSTANDING_BY_STATUS` now
 *     subtract `SUM(gross_amount)` of ISSUED credit notes, so a credited invoice
 *     stops being outstanding (§15 Q5's Model A: the credit is visible in the
 *     derived balance, because `Invoice.status` is deliberately never rewritten).
 *   - `V_FINANCE_REVENUE_BY_PERIOD` now nets off SUCCEEDED refunds, because §2
 *     classifies a refund as *"Debit revenue / credit cash"* — a revenue effect —
 *     while a credit note is *"credit receivables"*, a balance effect. Each is
 *     netted in exactly one place, so no figure is adjusted twice.
 *   - Both outstanding views gain a `total_credited` column, appended LAST
 *     because `CREATE OR REPLACE VIEW` may only add columns at the end.
 *
 * Ordering: this must sort ABOVE 1788965263258 (the table migration), which it
 * does. Reverting matters too — `down` must remove the new table references
 * before 258's `down` drops the tables, or PostgreSQL would refuse the DROP
 * because a view still depends on them. Reverse timestamp order guarantees that.
 *
 * `down` DROPS the three views rather than restoring the payments-only
 * definitions. That is a deliberate trade-off, stated plainly: the pre-P3-02 SQL
 * is not recoverable from code, because these builders are the single source and
 * they have (correctly) moved on — re-rendering "the old version" is impossible
 * without duplicating the old SQL here purely to keep a revert path, which would
 * create a second definition of the same view that nothing keeps in step. Views
 * hold no data, so nothing is lost, and `migration:run` recreates all three
 * immediately. The important property this preserves is that reverting 258 can
 * always drop its tables.
 */
export class AddRefundsAndCreditNotesToFinanceLedgerViews1788965263259
  implements MigrationInterface
{
  name = 'AddRefundsAndCreditNotesToFinanceLedgerViews1788965263259';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(buildMemberOutstandingViewSql());
    await queryRunner.query(buildRevenueByPeriodViewSql());
    await queryRunner.query(buildOutstandingByStatusViewSql());
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP VIEW IF EXISTS ${sqlIdentifier(FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS)}`,
    );
    await queryRunner.query(
      `DROP VIEW IF EXISTS ${sqlIdentifier(FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD)}`,
    );
    await queryRunner.query(
      `DROP VIEW IF EXISTS ${sqlIdentifier(FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING)}`,
    );
  }
}
