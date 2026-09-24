import { MigrationInterface, QueryRunner } from "typeorm";

export const REPORTING_MATERIALIZED_VIEW_NAMES = [
  "reports_mv_daily_attendance",
  "reports_mv_daily_revenue",
  "reports_mv_membership_summary",
  "reports_mv_daily_workouts",
  "reports_mv_member_churn_monthly",
  "reports_mv_membership_active_monthly",
] as const;

export const REPORTING_MATERIALIZED_VIEW_DESCRIPTIONS: Readonly<
  Record<string, string>
> = {
  reports_mv_daily_attendance:
    "Daily attendance per organization and branch, bucketed by each organization's local calendar date.",
  reports_mv_daily_revenue:
    "Daily invoice revenue per organization and branch, bucketed by each organization's local calendar date.",
  reports_mv_membership_summary:
    "Membership counts per organization, plan and membership status.",
  reports_mv_daily_workouts:
    "Daily workout-session counts and average duration per organization and member.",
  reports_mv_member_churn_monthly:
    "Monthly member churn per organization: active members, churned members and churn rate, bucketed by UTC calendar month.",
  reports_mv_membership_active_monthly:
    "Monthly active membership counts per organization: distinct active members and active memberships, bucketed by UTC calendar month.",
};

/**
 * Phase 6 — reporting materialized views.
 *
 * The attendance and revenue views resolve an organization's timezone against
 * PostgreSQL's live `pg_timezone_names` catalog. A materialized organization
 * CTE resolves the value once per organization before joining fact rows, so an
 * invalid timezone falls back to UTC without probing the catalog per fact row.
 */
export class CreateReportingMaterializedViews1788965263406 implements MigrationInterface {
  name = "CreateReportingMaterializedViews1788965263406";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE MATERIALIZED VIEW "reports_mv_daily_attendance" AS
            WITH organization_timezones AS MATERIALIZED (
                SELECT
                    o.id,
                    COALESCE((SELECT tz.name FROM pg_timezone_names tz WHERE tz.name = o.timezone LIMIT 1), 'UTC') AS timezone
                FROM "TENANCY_ORGANIZATIONS" o
            )
            SELECT
                r.organization_id,
                r.branch_id,
                (r.check_in_time AT TIME ZONE o.timezone)::date AS date,
                COUNT(*) AS total_check_ins,
                COUNT(DISTINCT r.member_id) AS unique_members,
                AVG(EXTRACT(EPOCH FROM (r.check_out_time - r.check_in_time)) / 60)::int AS avg_duration_minutes
            FROM "ATTENDANCE_ATTENDANCE_RECORDS" r
            INNER JOIN organization_timezones o ON o.id = r.organization_id
            WHERE r.check_out_time IS NOT NULL
            GROUP BY
                r.organization_id,
                r.branch_id,
                (r.check_in_time AT TIME ZONE o.timezone)::date;
        `);

    await queryRunner.query(`
            CREATE INDEX "IDX_reports_mv_daily_attendance_org_date"
            ON "reports_mv_daily_attendance" ("organization_id", "date");
        `);

    await queryRunner.query(`
            CREATE MATERIALIZED VIEW "reports_mv_daily_revenue" AS
            WITH organization_timezones AS MATERIALIZED (
                SELECT
                    o.id,
                    COALESCE((SELECT tz.name FROM pg_timezone_names tz WHERE tz.name = o.timezone LIMIT 1), 'UTC') AS timezone
                FROM "TENANCY_ORGANIZATIONS" o
            )
            SELECT
                i.organization_id,
                i.branch_id,
                (i.invoice_date AT TIME ZONE o.timezone)::date AS date,
                COUNT(*) AS invoice_count,
                SUM(i.total_amount) AS total_revenue,
                SUM(CASE WHEN i.status = 'paid' THEN i.total_amount ELSE 0 END) AS collected_revenue,
                COUNT(CASE WHEN i.status NOT IN ('paid', 'void') AND i.due_date < now() THEN 1 END) AS overdue_count
            FROM "FINANCE_INVOICES" i
            INNER JOIN organization_timezones o ON o.id = i.organization_id
            GROUP BY
                i.organization_id,
                i.branch_id,
                (i.invoice_date AT TIME ZONE o.timezone)::date;
        `);

    await queryRunner.query(`
            CREATE INDEX "IDX_reports_mv_daily_revenue_org_date"
            ON "reports_mv_daily_revenue" ("organization_id", "date");
        `);

    await queryRunner.query(`
            CREATE MATERIALIZED VIEW "reports_mv_membership_summary" AS
            SELECT
                organization_id,
                plan_id,
                status,
                COUNT(*) AS member_count
            FROM "MEMBERSHIPS_MEMBERSHIPS"
            GROUP BY organization_id, plan_id, status;
        `);

    await queryRunner.query(`
            CREATE INDEX "IDX_reports_mv_membership_summary_org"
            ON "reports_mv_membership_summary" ("organization_id");
        `);

    await queryRunner.query(`
            CREATE MATERIALIZED VIEW "reports_mv_daily_workouts" AS
            SELECT
                organization_id,
                member_id,
                session_date AS date,
                COUNT(*) AS session_count,
                AVG(duration_minutes)::int AS avg_duration_minutes
            FROM "WORKOUTS_WORKOUT_SESSIONS"
            GROUP BY organization_id, member_id, session_date;
        `);

    await queryRunner.query(`
            CREATE INDEX "IDX_reports_mv_daily_workouts_org_date"
            ON "reports_mv_daily_workouts" ("organization_id", "date");
        `);

    await queryRunner.query(`
            CREATE MATERIALIZED VIEW "reports_mv_member_churn_monthly" AS
            WITH member_months AS (
                SELECT m.organization_id, m.member_id, m.id AS membership_id,
                       date_trunc('month', gs.month)::date AS month
                FROM "MEMBERSHIPS_MEMBERSHIPS" m
                CROSS JOIN LATERAL generate_series(
                    date_trunc('month', m.start_date::timestamp),
                    date_trunc('month', COALESCE(m.end_date, (now() AT TIME ZONE 'UTC')::date)::timestamp),
                    interval '1 month'
                ) AS gs(month)
                WHERE (gs.month + interval '1 month - 1 day')::date >= m.start_date
                  AND (m.end_date IS NULL OR gs.month::date <= m.end_date)
                  AND gs.month::date <= COALESCE(
                        (SELECT MIN(c.occurred_at AT TIME ZONE 'UTC')::date
                           FROM "MEMBERSHIPS_MEMBERSHIP_HISTORY" c
                          WHERE c.to_status IN ('cancelled', 'expired')
                            AND c.membership_id = m.id),
                        DATE '9999-12-31')
            ),
            terminated AS (
                SELECT DISTINCT h.membership_id,
                       date_trunc('month', h.occurred_at AT TIME ZONE 'UTC')::date AS month
                FROM "MEMBERSHIPS_MEMBERSHIP_HISTORY" h
                WHERE h.to_status IN ('cancelled', 'expired')
            )
            SELECT a.organization_id, a.month,
                   COUNT(DISTINCT a.member_id) AS active_members,
                   COUNT(DISTINCT CASE WHEN t.membership_id IS NOT NULL THEN a.member_id END) AS churned_members,
                   ROUND(COUNT(DISTINCT CASE WHEN t.membership_id IS NOT NULL THEN a.member_id END)::numeric
                         / NULLIF(COUNT(DISTINCT a.member_id), 0) * 100, 2) AS churn_rate_pct
            FROM member_months a
            LEFT JOIN terminated t ON t.membership_id = a.membership_id AND t.month = a.month
            GROUP BY a.organization_id, a.month;
        `);

    await queryRunner.query(`
            CREATE INDEX "IDX_reports_mv_member_churn_monthly_org_month"
            ON "reports_mv_member_churn_monthly" ("organization_id", "month");
        `);

    await queryRunner.query(`
            CREATE MATERIALIZED VIEW "reports_mv_membership_active_monthly" AS
            SELECT m.organization_id,
                   date_trunc('month', gs.month)::date AS month,
                   COUNT(DISTINCT m.member_id) AS active_members,
                   COUNT(DISTINCT m.id) AS active_memberships
            FROM "MEMBERSHIPS_MEMBERSHIPS" m
            CROSS JOIN LATERAL generate_series(
                date_trunc('month', m.start_date::timestamp),
                date_trunc('month', COALESCE(m.end_date, (now() AT TIME ZONE 'UTC')::date)::timestamp),
                interval '1 month'
            ) AS gs(month)
            WHERE (gs.month + interval '1 month - 1 day')::date >= m.start_date
              AND (m.end_date IS NULL OR gs.month::date <= m.end_date)
              AND gs.month::date <= COALESCE(
                    (SELECT MIN(c.occurred_at AT TIME ZONE 'UTC')::date
                       FROM "MEMBERSHIPS_MEMBERSHIP_HISTORY" c
                      WHERE c.to_status IN ('cancelled', 'expired')
                        AND c.membership_id = m.id),
                    DATE '9999-12-31')
            GROUP BY m.organization_id, date_trunc('month', gs.month)::date;
        `);

    await queryRunner.query(`
            CREATE INDEX "IDX_reports_mv_membership_active_monthly_org_month"
            ON "reports_mv_membership_active_monthly" ("organization_id", "month");
        `);

    for (const name of REPORTING_MATERIALIZED_VIEW_NAMES) {
      await queryRunner.query(
        `INSERT INTO "REPORTS_MATERIALIZED_VIEWS" ("name", "description") VALUES ($1, $2)`,
        [name, REPORTING_MATERIALIZED_VIEW_DESCRIPTIONS[name]],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [...REPORTING_MATERIALIZED_VIEW_NAMES].reverse()) {
      await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS "${name}"`);
    }

    await queryRunner.query(
      `DELETE FROM "REPORTS_MATERIALIZED_VIEWS" WHERE "name" = ANY($1::varchar[])`,
      [Array.from(REPORTING_MATERIALIZED_VIEW_NAMES)],
    );
  }
}
