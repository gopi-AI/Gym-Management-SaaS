import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Member } from '../../members/entities/member.entity';
import { Invoice } from '../../finance/entities/invoice.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';
import { ReportQueryValidator } from './report-query-validator.service';
import { ReportQueryBuilder } from './report-query-builder.service';
import type { QueryDefinition } from '../types/query-definition';

/** Definitions are runtime data (a jsonb column), so they are built as `unknown`. */
const def = (value: unknown): QueryDefinition => value as QueryDefinition;

const ENABLED = Boolean(process.env.DB_HOST);
const describeDb = ENABLED ? describe : describe.skip;

/**
 * End-to-end Phase A proof against a real database (P6-02/P6-03).
 *
 * Validation alone would not show that a built query returns the right *rows*: a
 * correct-looking `SelectQueryBuilder` can still select the wrong things. These tests
 * run the built queries and assert on real result rows, across the three domains P6-07
 * scopes (member, finance, attendance), with fixtures for **two** organizations so
 * tenant scoping is demonstrated rather than assumed.
 *
 * The bucketed case matters most. §6.x's `period`/`week`/`month` keys are time buckets,
 * and one test below runs the same definition twice — grouping by the bucket alias, and
 * grouping by the raw column — to show the row counts differ. That is the "succeeds but
 * returns wrong data" failure §17's preamble warns about, shown live rather than argued.
 */
describeDb('ReportQuery execution against a real database (Phase A)', () => {
  let ds: DataSource;
  let validator: ReportQueryValidator;
  let builder: ReportQueryBuilder;

  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  const memberA1 = crypto.randomUUID();
  const memberA2 = crypto.randomUUID();
  const memberA3 = crypto.randomUUID();
  const memberB1 = crypto.randomUUID();

  const run = async (
    definition: unknown,
    organizationId: string,
    parameters?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> => {
    const validated = await validator.validate(def(definition), { organizationId, parameters });
    return builder.build(validated).getRawMany<Record<string, unknown>>();
  };

  beforeAll(async () => {
    ds = AppDataSource;
    await ds.initialize();
    await ds.runMigrations();
    validator = new ReportQueryValidator(ds);
    builder = new ReportQueryBuilder(ds);

    await ds.getRepository(Organization).save([
      { id: orgA, name: 'report-a', timezone: 'UTC', locale: 'en-US', currency: 'USD' },
      { id: orgB, name: 'report-b', timezone: 'UTC', locale: 'en-US', currency: 'USD' },
    ]);
    await ds.getRepository(Branch).save([
      { id: branchA, organization_id: orgA, name: 'A', address: 'a', phone: '1' },
      { id: branchB, organization_id: orgB, name: 'B', address: 'b', phone: '2' },
    ]);

    const member = (id: string, organization_id: string, branch_id: string, local: number) => ({
      id, organization_id, branch_id, global_uuid: crypto.randomUUID(), local_id: local,
      first_name: 'R', last_name: 'Fixture',
    });
    await ds.getRepository(Member).save([
      member(memberA1, orgA, branchA, 1),
      member(memberA2, orgA, branchA, 2),
      member(memberA3, orgA, branchA, 3),
      member(memberB1, orgB, branchB, 4),
    ]);

    // Two org-A members in January 2026, one in February 2026; one org-B member in
    // January. The bucket test must see 2/1 for org A and never org B's row.
    const setCreatedAt = (table: string, id: string, iso: string) =>
      ds.query(`UPDATE "${table}" SET created_at = $1 WHERE id = $2`, [iso, id]);
    await setCreatedAt('MEMBERS_MEMBERS', memberA1, '2026-01-05T10:00:00.000Z');
    await setCreatedAt('MEMBERS_MEMBERS', memberA2, '2026-01-20T10:00:00.000Z');
    await setCreatedAt('MEMBERS_MEMBERS', memberA3, '2026-02-10T10:00:00.000Z');
    await setCreatedAt('MEMBERS_MEMBERS', memberB1, '2026-01-07T10:00:00.000Z');

    const savedInvoices = await ds.getRepository(Invoice).save([
      { organization_id: orgA, member_id: memberA1, invoice_number: 'A-1', invoice_date: new Date('2026-01-05'), due_date: new Date('2026-02-05'), subtotal: '100.00', total_amount: '100.00', status: 'paid' },
      { organization_id: orgA, member_id: memberA2, invoice_number: 'A-2', invoice_date: new Date('2026-01-06'), due_date: new Date('2026-02-06'), subtotal: '50.00', total_amount: '50.00', status: 'paid' },
      { organization_id: orgA, member_id: memberA3, invoice_number: 'A-3', invoice_date: new Date('2026-02-07'), due_date: new Date('2026-03-07'), subtotal: '20.00', total_amount: '20.00', status: 'draft' },
      { organization_id: orgB, member_id: memberB1, invoice_number: 'B-1', invoice_date: new Date('2026-01-08'), due_date: new Date('2026-02-08'), subtotal: '999.00', total_amount: '999.00', status: 'paid' },
    ]);

    // `created_at` is a @CreateDateColumn, so it is stamped "now" on insert. The §17
    // example filters on it, so the fixture has to move it into the reported window —
    // the first run of this test returned 0 rows for exactly that reason, which was
    // the executor filtering correctly against a fixture that had not set the column.
    for (const invoice of savedInvoices) {
      const iso = invoice.invoice_date.toISOString();
      await setCreatedAt('FINANCE_INVOICES', invoice.id, iso);
    }

    await ds.getRepository(AttendanceRecord).save([
      { organization_id: orgA, member_id: memberA1, check_in_time: new Date('2026-01-05T11:00:00.000Z') },
      { organization_id: orgA, member_id: memberA2, check_in_time: new Date('2026-01-06T11:00:00.000Z') },
      { organization_id: orgB, member_id: memberB1, check_in_time: new Date('2026-01-07T11:00:00.000Z') },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    const orgs = [orgA, orgB];
    await ds.query(`DELETE FROM "ATTENDANCE_ATTENDANCE_RECORDS" WHERE organization_id = ANY($1)`, [orgs]);
    await ds.query(`DELETE FROM "FINANCE_INVOICES" WHERE organization_id = ANY($1)`, [orgs]);
    await ds.query(`DELETE FROM "MEMBERS_MEMBERS" WHERE organization_id = ANY($1)`, [orgs]);
    await ds.query(`DELETE FROM "TENANCY_BRANCHES" WHERE organization_id = ANY($1)`, [orgs]);
    await ds.query(`DELETE FROM "TENANCY_ORGANIZATIONS" WHERE id = ANY($1)`, [orgs]);
    await ds.destroy();
  });

  it('§17 Filtered Aggregate: real Invoice rows grouped by status, ordered by the alias', async () => {
    const rows = await run(
      {
        source: 'Invoice',
        columns: {
          status: 'status',
          total: { fn: 'SUM', column: 'total_amount' },
          count: { fn: 'COUNT', column: '*' },
        },
        filters: [{ column: 'created_at', operator: 'BETWEEN', value: ['$from', '$to'] }],
        group_by: ['status'],
        order_by: [{ column: 'total', direction: 'DESC' }],
      },
      orgA,
      { from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
    );

    // Org A's three invoices: 100 + 50 paid, 20 draft. Org B's 999 is absent.
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('paid');
    expect(Number(rows[0].total)).toBe(150);
    expect(Number(rows[0].count)).toBe(2);
    expect(rows[1].status).toBe('draft');
    expect(Number(rows[1].total)).toBe(20);
    expect(rows.some((r) => Number(r.total) === 999)).toBe(false);
  });

  it('§6.1 New Members: a month BUCKET yields one row per month, not per timestamp', async () => {
    const rows = await run(
      {
        source: 'Member',
        columns: {
          month: { bucket: 'created_at', unit: 'month' },
          count: { fn: 'COUNT', column: '*' },
        },
        group_by: ['month'],
        order_by: [{ column: 'month', direction: 'ASC' }],
        limit: 12,
      },
      orgA,
    );

    expect(rows).toHaveLength(2);
    expect(Number(rows[0].count)).toBe(2); // January: memberA1 + memberA2
    expect(Number(rows[1].count)).toBe(1); // February: memberA3
    expect(rows[0].month).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(rows[1].month).toEqual(new Date('2026-02-01T00:00:00.000Z'));
    // Org B's January member is not counted.
    expect(rows.reduce((sum, r) => sum + Number(r.count), 0)).toBe(3);
  });

  it('the alias-first group_by rule is load-bearing: grouping by the RAW column gives 3 rows', async () => {
    // Same fixture, same source — only the grouping target differs. `created_at` is a
    // source column (no alias of that name is selected), so this groups per timestamp.
    // That is precisely what §17's first example would have done silently if group_by
    // resolved against source columns only: it succeeds, and returns the wrong rows.
    const rows = await run(
      {
        source: 'Member',
        columns: {
          month: { bucket: 'created_at', unit: 'month' },
          count: { fn: 'COUNT', column: '*' },
        },
        group_by: ['created_at'],
      },
      orgA,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => Number(r.count) === 1)).toBe(true);
  });

  it('tenant scoping: an org sees its own rows and only its own', async () => {
    const forA = await run(
      { source: 'AttendanceRecord', columns: { rows: { fn: 'COUNT', column: '*' } } },
      orgA,
    );
    const forB = await run(
      { source: 'AttendanceRecord', columns: { rows: { fn: 'COUNT', column: '*' } } },
      orgB,
    );
    expect(Number(forA[0].rows)).toBe(2); // org A's two check-ins
    expect(Number(forB[0].rows)).toBe(1); // org B's single check-in
  });

  it('filters execute as bound parameters: BETWEEN, IN and =', async () => {
    const januaryOnly = await run(
      {
        source: 'Member',
        columns: {
          month: { bucket: 'created_at', unit: 'month' },
          count: { fn: 'COUNT', column: '*' },
        },
        filters: [
          { column: 'created_at', operator: 'BETWEEN', value: ['2026-01-01', '2026-02-01'] },
        ],
        group_by: ['month'],
      },
      orgA,
    );
    expect(januaryOnly).toHaveLength(1);
    expect(Number(januaryOnly[0].count)).toBe(2);

    const paidOnly = await run(
      {
        source: 'Invoice',
        columns: { status: 'status', total: { fn: 'SUM', column: 'total_amount' } },
        filters: [{ column: 'status', operator: 'IN', value: ['paid'] }],
        group_by: ['status'],
      },
      orgA,
    );
    expect(paidOnly).toHaveLength(1);
    expect(Number(paidOnly[0].total)).toBe(150);

    const byNumber = await run(
      {
        source: 'Invoice',
        columns: { number: 'invoice_number', amount: 'total_amount' },
        filters: [{ column: 'invoice_number', operator: '=', value: 'A-3' }],
      },
      orgA,
    );
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0].amount).toBe('20.00');
  });

  it('LIMIT applies, and the built SQL carries placeholders rather than values', async () => {
    const limited = await run(
      {
        source: 'Member',
        columns: { id: 'id' },
        filters: [{ column: 'first_name', operator: '=', value: 'R' }],
        order_by: [{ column: 'id', direction: 'ASC' }],
        limit: 2,
      },
      orgA,
    );
    expect(limited).toHaveLength(2);

    // Parameterisation, asserted on the SQL the builder produced. TypeORM renders
    // native placeholders (`$1`, `$2`), not the `:name` form it accepts — so the
    // meaningful assertions are that no literal value reached the SQL and that the
    // values are still bound as parameters.
    const validated = await validator.validate(
      def({
        source: 'Member',
        columns: { id: 'id' },
        filters: [{ column: 'first_name', operator: '=', value: 'R' }],
      }),
      { organizationId: orgA },
    );
    const built = builder.build(validated);
    expect(built.getSql()).not.toContain("'R'");
    expect(built.getSql()).toMatch(/\$\d+/); // native placeholders only
    expect(built.getParameters()).toMatchObject({ f0: 'R', orgId: orgA });
  });
});

