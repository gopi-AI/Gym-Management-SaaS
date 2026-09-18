import {
  CreateFinanceLedgerViews1788965263253,
  buildMemberOutstandingViewSql,
  buildOutstandingByStatusViewSql,
  buildRevenueByPeriodViewSql,
} from '../1788965263253-CreateFinanceLedgerViews';
import {
  AGEING_BUCKET_ORDER,
  FINANCE_LEDGER_VIEWS,
  SQL_DAYS_OVERDUE,
  SQL_SUCCEEDED_PAYMENT,
} from '../../finance/ledger.constants';
import { OUTSTANDING_INVOICE_STATUSES, PAYMENT_STATUS } from '../../finance/finance.constants';

/**
 * Verification of the P3-01 ledger read-model migration.
 *
 * This file lives in `src/migrations/__specs__/` on purpose: `src/migrations/*`
 * is loaded wholesale by the TypeORM CLI, while `jest` still finds this spec.
 *
 * Two properties are worth pinning, and neither is visible from the migration
 * alone:
 *
 *   1. **The views are PLAIN views.** The plan recommended materialized views
 *      and the approved design is plain views for all three. A stray
 *      `MATERIALIZED` keyword would silently reintroduce the staleness problem
 *      the decision removed, so it is asserted absent rather than assumed.
 *   2. **The SQL is generated from the shared constants.** The status list and
 *      the ageing buckets exist once, in `ledger.constants.ts`, and are rendered
 *      into the DDL. These assertions fail the moment the two drift — which is
 *      the failure mode that would otherwise let a report disagree with the
 *      write path without anything breaking.
 *
 * The in-memory QueryRunner records the exact statements emitted, so the
 * statements themselves are inspected rather than a mock's return value.
 */
class RecordingQueryRunner {
  readonly statements: string[] = [];

  async query(sql: string): Promise<Array<Record<string, unknown>>> {
    this.statements.push(sql.replace(/\s+/g, ' ').trim());
    return [];
  }

  /** Statements matching a pattern, for concise assertions. */
  matching(pattern: RegExp): string[] {
    return this.statements.filter((statement) => pattern.test(statement));
  }
}

describe('CreateFinanceLedgerViews1788965263253', () => {
  let migration: CreateFinanceLedgerViews1788965263253;
  let runner: RecordingQueryRunner;

  beforeEach(() => {
    migration = new CreateFinanceLedgerViews1788965263253();
    runner = new RecordingQueryRunner();
  });


  describe('up', () => {
    beforeEach(async () => {
      await migration.up(runner as never);
    });

    it('creates all three views and the supporting index', () => {
      expect(runner.matching(/^CREATE OR REPLACE VIEW/)).toHaveLength(3);
      expect(runner.matching(/^CREATE INDEX/)).toHaveLength(1);
    });

    it('creates plain views, never materialized ones', () => {
      // A materialized view would need refreshing, and the API would have to
      // explain the staleness — exactly what the approved decision avoids.
      for (const statement of runner.statements) {
        expect(statement).not.toMatch(/MATERIALIZED/i);
        expect(statement).not.toMatch(/REFRESH/i);
      }
    });

    it('names the views exactly as the shared constants do', () => {
      for (const view of Object.values(FINANCE_LEDGER_VIEWS)) {
        expect(runner.matching(new RegExp(`^CREATE OR REPLACE VIEW "${view}"`))).toHaveLength(1);
      }
    });

    it('indexes the base table on the access path the views use', () => {
      const [index] = runner.matching(/^CREATE INDEX/);

      // A plain view is not indexable, so the access path must live on the base
      // table: (organization_id, member_id, status) is what the member-balance
      // and by-status GROUP BY / WHERE clauses filter on.
      expect(index).toContain('IDX_finance_invoices_org_member_status');
      expect(index).toContain('"FINANCE_INVOICES"');
      expect(index).toContain('("organization_id", "member_id", "status")');
    });

    it('renders the outstanding status list from OUTSTANDING_INVOICE_STATUSES', () => {
      const rendered = OUTSTANDING_INVOICE_STATUSES.map((status) => `'${status}'`).join(', ');
      const memberView = buildMemberOutstandingViewSql();

      expect(memberView).toContain(`IN (${rendered})`);
      // paid/void must never be counted as money owed.
      expect(memberView).not.toContain("'paid'");
      expect(memberView).not.toContain("'void'");
    });

    it('counts only succeeded payments as money received', () => {
      expect(SQL_SUCCEEDED_PAYMENT).toBe(`'${PAYMENT_STATUS.SUCCEEDED}'`);
      expect(buildMemberOutstandingViewSql()).toContain(SQL_SUCCEEDED_PAYMENT);
      expect(buildRevenueByPeriodViewSql()).toContain(SQL_SUCCEEDED_PAYMENT);
    });

    it('groups the by-status view by every ageing bucket the API can report', () => {
      const sql = buildOutstandingByStatusViewSql();

      for (const bucket of AGEING_BUCKET_ORDER) {
        expect(sql).toContain(`'${bucket}'`);
      }
      expect(sql).toContain(SQL_DAYS_OVERDUE);
    });

    it('derives the member balance from invoices and payments, never a denormalised column', () => {
      const sql = buildMemberOutstandingViewSql();

      expect(sql).toContain('"FINANCE_INVOICES"');
      expect(sql).toContain('"FINANCE_PAYMENTS"');
      // Phase 1 deliberately kept `amount_paid` off the invoice table.
      expect(sql).not.toMatch(/amount_paid/);
    });

    it('writes nothing to any base table', () => {
      for (const statement of runner.statements) {
        for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'DROP TABLE', 'ALTER TABLE']) {
          expect(statement.toUpperCase()).not.toContain(verb);
        }
      }
    });
  });

  describe('down', () => {
    it('drops the three views and the index, and nothing else', async () => {
      await migration.down(runner as never);

      expect(runner.matching(/^DROP VIEW IF EXISTS/)).toHaveLength(3);
      expect(runner.matching(/^DROP INDEX IF EXISTS/)).toHaveLength(1);

      for (const view of Object.values(FINANCE_LEDGER_VIEWS)) {
        expect(runner.matching(new RegExp(`^DROP VIEW IF EXISTS "${view}"`))).toHaveLength(1);
      }

      // Views hold no data, so the reversal must not touch any table.
      expect(runner.matching(/DROP TABLE/i)).toHaveLength(0);
      expect(runner.matching(/DELETE FROM/i)).toHaveLength(0);
    });

    it('is safe to run twice', async () => {
      await migration.down(runner as never);
      await migration.down(runner as never);

      // Every statement is IF EXISTS, so a re-run is a no-op rather than an error.
      expect(runner.matching(/^(DROP VIEW|DROP INDEX) IF EXISTS/)).toHaveLength(8);
    });
  });

  it('up is re-runnable because every view is CREATE OR REPLACE', () => {
    const statements = [
      buildMemberOutstandingViewSql(),
      buildRevenueByPeriodViewSql(),
      buildOutstandingByStatusViewSql(),
    ];

    for (const statement of statements) {
      expect(statement).toContain('CREATE OR REPLACE VIEW');
    }
  });
});

