import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";

jest.setTimeout(120_000);

const requiredDatabaseEnvironment = [
  "DB_HOST",
  "DB_PORT",
  "DB_USERNAME",
  "DB_PASSWORD",
].every((name) => Boolean(process.env[name]));
const enabled =
  process.env.REPORTING_MV_INTEGRATION === "1" && requiredDatabaseEnvironment;
const describeDb = enabled ? describe : describe.skip;

/**
 * Real PostgreSQL proof for the reporting migration's timezone bucketing.
 *
 * The test creates and drops a uniquely named database. It never runs against
 * DB_DATABASE, which keeps the development database out of the test lifecycle.
 */
describeDb("reporting materialized views PostgreSQL integration", () => {
  let databaseName: string;
  let dataSource: DataSource;

  const connectionOptions = {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT!),
    username: process.env.DB_USERNAME!,
    password: process.env.DB_PASSWORD!,
  };

  beforeAll(async () => {
    databaseName = `gym_reporting_mv_test_${randomUUID().replace(/-/g, "")}`;
    const admin = new DataSource({
      type: "postgres",
      ...connectionOptions,
      database: process.env.DB_ADMIN_DATABASE || "postgres",
    });
    await admin.initialize();
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    } finally {
      await admin.destroy();
    }

    dataSource = new DataSource({
      type: "postgres",
      ...connectionOptions,
      database: databaseName,
      entities: [__dirname + "/../../**/*.entity{.ts,.js}"],
      migrations: [__dirname + "/../*{.ts,.js}"],
      migrationsTableName: "typeorm_migrations",
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    const admin = new DataSource({
      type: "postgres",
      ...connectionOptions,
      database: process.env.DB_ADMIN_DATABASE || "postgres",
    });
    await admin.initialize();
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await admin.destroy();
    }
  });

  it("buckets a check-in by the organization's local date", async () => {
    const organizationId = randomUUID();
    const branchId = randomUUID();
    const memberId = randomUUID();

    await dataSource.query(
      `INSERT INTO "TENANCY_ORGANIZATIONS" ("id", "name", "timezone", "locale", "currency")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        organizationId,
        "LA reporting test",
        "America/Los_Angeles",
        "en-US",
        "USD",
      ],
    );
    await dataSource.query(
      `INSERT INTO "TENANCY_BRANCHES" ("id", "organization_id", "name", "address", "phone")
       VALUES ($1, $2, $3, $4, $5)`,
      [branchId, organizationId, "LA test branch", "test", "000"],
    );
    await dataSource.query(
      `INSERT INTO "MEMBERS_MEMBERS"
        ("id", "organization_id", "branch_id", "global_uuid", "local_id", "first_name", "last_name")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [memberId, organizationId, branchId, randomUUID(), 1, "Timezone", "Test"],
    );
    await dataSource.query(
      `INSERT INTO "ATTENDANCE_ATTENDANCE_RECORDS"
        ("id", "organization_id", "branch_id", "member_id", "check_in_time", "check_out_time")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        organizationId,
        branchId,
        memberId,
        "2026-01-02T00:30:00Z",
        "2026-01-02T01:30:00Z",
      ],
    );
    await dataSource.query(
      `REFRESH MATERIALIZED VIEW "reports_mv_daily_attendance"`,
    );

    const rows = await dataSource.query(
      `SELECT "date"::text AS "date", "total_check_ins"
         FROM "reports_mv_daily_attendance"
        WHERE "organization_id" = $1`,
      [organizationId],
    );

    expect(rows).toEqual([{ date: "2026-01-01", total_check_ins: "1" }]);
  });
});
