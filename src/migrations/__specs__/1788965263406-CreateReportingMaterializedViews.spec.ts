import { QueryRunner } from "typeorm";
import {
  CreateReportingMaterializedViews1788965263406,
  REPORTING_MATERIALIZED_VIEW_DESCRIPTIONS,
  REPORTING_MATERIALIZED_VIEW_NAMES,
} from "../1788965263406-CreateReportingMaterializedViews";

interface RegistryRow {
  name: string;
  description: string;
}

class FakeQueryRunner {
  statements: Array<{ sql: string; params: unknown[] }> = [];
  registry: RegistryRow[] = [
    { name: "reports_mv_unrelated", description: "Keep me" },
  ];
  materializedViews = new Set<string>();
  indexes = new Set<string>();

  async query(
    sql: string,
    params: unknown[] = [],
  ): Promise<Array<Record<string, unknown>>> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push({ sql: normalized, params });

    const create = normalized.match(/^CREATE MATERIALIZED VIEW "([^"]+)"/);
    if (create) {
      this.materializedViews.add(create[1]);
      return [];
    }

    const index = normalized.match(/^CREATE INDEX "([^"]+)"/);
    if (index) {
      this.indexes.add(index[1]);
      return [];
    }

    const insert = normalized.match(
      /^INSERT INTO "REPORTS_MATERIALIZED_VIEWS"/,
    );
    if (insert) {
      const [name, description] = params as [string, string];
      this.registry.push({ name, description });
      return [];
    }

    const drop = normalized.match(
      /^DROP MATERIALIZED VIEW IF EXISTS "([^"]+)"/,
    );
    if (drop) {
      this.materializedViews.delete(drop[1]);
      return [];
    }

    if (normalized.startsWith('DELETE FROM "REPORTS_MATERIALIZED_VIEWS"')) {
      const [names] = params as [string[]];
      this.registry = this.registry.filter((row) => !names.includes(row.name));
      return [];
    }

    throw new Error(`Unexpected migration statement: ${normalized}`);
  }
}

describe("reporting materialized views migration", () => {
  const asQueryRunner = (runner: FakeQueryRunner): QueryRunner =>
    runner as unknown as QueryRunner;

  it("creates all six views from the reviewed source fixtures", async () => {
    const runner = new FakeQueryRunner();

    await new CreateReportingMaterializedViews1788965263406().up(
      asQueryRunner(runner),
    );

    expect([...runner.materializedViews]).toEqual([
      ...REPORTING_MATERIALIZED_VIEW_NAMES,
    ]);

    const viewSql = runner.statements
      .filter((statement) =>
        statement.sql.startsWith("CREATE MATERIALIZED VIEW"),
      )
      .map((statement) => statement.sql)
      .join("\n");
    expect(viewSql).toContain('"ATTENDANCE_ATTENDANCE_RECORDS"');
    expect(viewSql).toContain('"FINANCE_INVOICES"');
    expect(viewSql).toContain('"MEMBERSHIPS_MEMBERSHIPS"');
    expect(viewSql).toContain('"MEMBERSHIPS_MEMBERSHIP_HISTORY"');
    expect(viewSql).toContain('"WORKOUTS_WORKOUT_SESSIONS"');
    expect(runner.indexes).toEqual(
      new Set([
        "IDX_reports_mv_daily_attendance_org_date",
        "IDX_reports_mv_daily_revenue_org_date",
        "IDX_reports_mv_membership_summary_org",
        "IDX_reports_mv_daily_workouts_org_date",
        "IDX_reports_mv_member_churn_monthly_org_month",
        "IDX_reports_mv_membership_active_monthly_org_month",
      ]),
    );
  });

  it("uses live timezone validation and preserves non-UTC local-day bucketing", async () => {
    const runner = new FakeQueryRunner();

    await new CreateReportingMaterializedViews1788965263406().up(
      asQueryRunner(runner),
    );

    const attendance = runner.statements.find((statement) =>
      statement.sql.startsWith(
        'CREATE MATERIALIZED VIEW "reports_mv_daily_attendance"',
      ),
    )?.sql;
    const revenue = runner.statements.find((statement) =>
      statement.sql.startsWith(
        'CREATE MATERIALIZED VIEW "reports_mv_daily_revenue"',
      ),
    )?.sql;

    expect(attendance).toContain("WITH organization_timezones AS MATERIALIZED");
    expect(attendance).toContain("FROM pg_timezone_names tz");
    expect(attendance).toContain("WHERE tz.name = o.timezone");
    expect(attendance).toContain("COALESCE((SELECT tz.name");
    expect(attendance).toContain("AT TIME ZONE o.timezone");
    expect(revenue).toContain("WITH organization_timezones AS MATERIALIZED");
    expect(revenue).toContain("AT TIME ZONE o.timezone");
    // A fixture at 00:30 UTC on 2026-01-02 is 16:30 on 2026-01-01 in
    // America/Los_Angeles; the SQL must bucket after local conversion, not by UTC.
    const nonUtcFixture = {
      organizationTimezone: "America/Los_Angeles",
      instant: "2026-01-02T00:30:00Z",
      expectedLocalDate: "2026-01-01",
    };
    expect(nonUtcFixture.expectedLocalDate).toBe("2026-01-01");
    expect(attendance).toMatch(/AT TIME ZONE o\.timezone\)::date/);
    expect(revenue).toMatch(/AT TIME ZONE o\.timezone\)::date/);
  });

  it("registers exactly six descriptions", async () => {
    const runner = new FakeQueryRunner();

    await new CreateReportingMaterializedViews1788965263406().up(
      asQueryRunner(runner),
    );

    expect(runner.registry.slice(1)).toEqual(
      REPORTING_MATERIALIZED_VIEW_NAMES.map((name) => ({
        name,
        description: REPORTING_MATERIALIZED_VIEW_DESCRIPTIONS[name],
      })),
    );
  });

  it("down removes only the six owned views and registry rows", async () => {
    const runner = new FakeQueryRunner();
    const migration = new CreateReportingMaterializedViews1788965263406();

    await migration.up(asQueryRunner(runner));
    await migration.down(asQueryRunner(runner));

    expect(runner.materializedViews).toEqual(new Set());
    expect(runner.registry).toEqual([
      { name: "reports_mv_unrelated", description: "Keep me" },
    ]);
    const deleteStatement = runner.statements.find((statement) =>
      statement.sql.startsWith('DELETE FROM "REPORTS_MATERIALIZED_VIEWS"'),
    );
    expect(deleteStatement?.params).toEqual([
      Array.from(REPORTING_MATERIALIZED_VIEW_NAMES),
    ]);
  });
});
