import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import {
  SYSTEM_REPORT_SCHEMA,
  SeedAvgSessionDurationSystemReport1788965263410,
} from '../1788965263410-SeedAvgSessionDurationSystemReport';
import { AddAttendanceDurationMinutes1788965263409 } from '../1788965263409-AddAttendanceDurationMinutes';
import { SYSTEM_REPORT_SCHEMAS } from '../../reports/constants/system-report-catalog';
import { provisionSystemReportSchemas } from '../../reports/services/system-report-schema-provisioner';

jest.setTimeout(120_000);

const requiredDatabaseEnvironment = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
].every((name) => Boolean(process.env[name]));
const enabled = process.env.P6_38_REPORT_INTEGRATION === '1' && requiredDatabaseEnvironment;
const describeDb = enabled ? describe : describe.skip;

/**
 * P6-38's two halves in one place: the **backfill** that gives existing sessions a
 * duration, and the **seed** that gives existing organizations the report row.
 *
 * The backfill is the part worth executing rather than asserting statically — its
 * arithmetic has to agree with the expression §7.2's materialized view already
 * uses for the same figure, and the only way to know that is to run both against
 * the same rows.
 */
describeDb('Avg Session Duration migration and provisioner PostgreSQL integration', () => {
  let databaseName: string;
  let dataSource: DataSource;

  const connectionOptions = {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT!),
    username: process.env.DB_USERNAME!,
    password: process.env.DB_PASSWORD!,
  };

  beforeAll(async () => {
    databaseName = `gym_p6_38_test_${randomUUID().replace(/-/g, '')}`;
    const admin = new DataSource({
      type: 'postgres',
      ...connectionOptions,
      database: process.env.DB_ADMIN_DATABASE || 'postgres',
    });
    await admin.initialize();
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    } finally {
      await admin.destroy();
    }

    const migrationsDirectory = join(__dirname, '..');
    // Every other migration runs first; this file's two migrations are applied by
    // hand below, so the backfill can be shown to operate on pre-existing rows.
    const existingMigrationFiles = readdirSync(migrationsDirectory)
      .filter(
        (file) =>
          /^\d+.*\.(ts|js)$/.test(file) &&
          !file.startsWith('1788965263410-SeedAvgSessionDurationSystemReport') &&
          !file.startsWith('1788965263409-AddAttendanceDurationMinutes'),
      )
      .map((file) => join(migrationsDirectory, file));

    dataSource = new DataSource({
      type: 'postgres',
      ...connectionOptions,
      database: databaseName,
      entities: [join(__dirname, '../../**/*.entity{.ts,.js}')],
      migrations: existingMigrationFiles,
      migrationsTableName: 'typeorm_migrations',
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

    if (!databaseName) {
      return;
    }

    const admin = new DataSource({
      type: 'postgres',
      ...connectionOptions,
      database: process.env.DB_ADMIN_DATABASE || 'postgres',
    });
    await admin.initialize();
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await admin.destroy();
    }
  });

  it('backfills closed sessions to whole minutes and leaves open sessions NULL', async () => {
    const organizationId = randomUUID();
    const branchId = randomUUID();
    const memberId = randomUUID();

    await dataSource.query(
      `INSERT INTO "TENANCY_ORGANIZATIONS" ("id", "name", "timezone", "locale", "currency")
       VALUES ($1, 'P6-38 backfill organization', 'UTC', 'en-US', 'USD')`,
      [organizationId],
    );
    await dataSource.query(
      `INSERT INTO "TENANCY_BRANCHES" ("id", "organization_id", "name", "address", "phone")
       VALUES ($1, $2, 'P6-38 branch', 'test', '000')`,
      [branchId, organizationId],
    );
    await dataSource.query(
      `INSERT INTO "MEMBERS_MEMBERS"
        ("id", "organization_id", "branch_id", "global_uuid", "local_id", "first_name", "last_name")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [memberId, organizationId, branchId, randomUUID(), 1, 'P6-38', 'Member'],
    );

    // Three closed sessions and one still-open one, written BEFORE the column
    // exists, so the backfill is what has to produce their durations.
    const closed = [
      { in: '2026-03-02T08:00:00Z', out: '2026-03-02T09:30:00Z', expected: 90 },
      // 90.5 minutes — rounds half away from zero, matching the MV. The parity
      // assertion below holds for these fixtures, which are all positive; a group
      // mixing rounding directions is a separate, pre-existing question filed as
      // P6-53, not covered here.
      { in: '2026-03-03T08:00:00Z', out: '2026-03-03T09:30:30Z', expected: 91 },
      // 45.48 minutes — rounds down.
      { in: '2026-03-04T08:00:00Z', out: '2026-03-04T08:45:29Z', expected: 45 },
    ];
    for (const session of closed) {
      await dataSource.query(
        `INSERT INTO "ATTENDANCE_ATTENDANCE_RECORDS"
          ("id", "organization_id", "branch_id", "member_id", "check_in_time", "check_out_time")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), organizationId, branchId, memberId, session.in, session.out],
      );
    }
    await dataSource.query(
      `INSERT INTO "ATTENDANCE_ATTENDANCE_RECORDS"
        ("id", "organization_id", "branch_id", "member_id", "check_in_time", "check_out_time")
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [randomUUID(), organizationId, branchId, memberId, '2026-03-05T08:00:00Z'],
    );

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await new AddAttendanceDurationMinutes1788965263409().up(runner);
    } finally {
      await runner.release();
    }

    const rows: Array<{ duration_minutes: number | null }> = await dataSource.query(
      `SELECT "duration_minutes"
         FROM "ATTENDANCE_ATTENDANCE_RECORDS"
        WHERE "organization_id" = $1
        ORDER BY "check_in_time" ASC`,
      [organizationId],
    );

    expect(rows.map((row) => row.duration_minutes)).toEqual([
      ...closed.map((session) => session.expected),
      null, // the open session has no duration, and must not be given a 0
    ]);

    // The backfilled value must equal the figure §7.2's view computes for the same
    // rows: both are the same measure over the same two timestamps, so a rounding
    // rule that differed between them would be a silent inconsistency.
    const [viewFigure] = await dataSource.query(
      `SELECT AVG(EXTRACT(EPOCH FROM ("check_out_time" - "check_in_time")) / 60)::int
                AS avg_duration_minutes
         FROM "ATTENDANCE_ATTENDANCE_RECORDS"
        WHERE "organization_id" = $1 AND "check_out_time" IS NOT NULL`,
      [organizationId],
    );
    const [storedFigure] = await dataSource.query(
      `SELECT AVG("duration_minutes")::int AS avg_duration_minutes
         FROM "ATTENDANCE_ATTENDANCE_RECORDS"
        WHERE "organization_id" = $1 AND "duration_minutes" IS NOT NULL`,
      [organizationId],
    );
    expect(storedFigure.avg_duration_minutes).toBe(viewFigure.avg_duration_minutes);

    // The new column must not disturb the partial UNIQUE index that enforces
    // "at most one open session per member".
    const openIndex = await dataSource.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'ATTENDANCE_ATTENDANCE_RECORDS'
          AND indexname = 'UQ_attendance_open_record'`,
    );
    expect(openIndex).toHaveLength(1);
  });

  it('seeds the catalog row for existing organizations, and provisions it for new ones', async () => {
    const existingSystemOrganizationId = randomUUID();
    const customSameNameOrganizationId = randomUUID();

    for (const [index, organizationId] of [
      existingSystemOrganizationId,
      customSameNameOrganizationId,
    ].entries()) {
      await dataSource.query(
        `INSERT INTO "TENANCY_ORGANIZATIONS" ("id", "name", "timezone", "locale", "currency")
         VALUES ($1, $2, 'UTC', 'en-US', 'USD')`,
        [organizationId, `P6-38 test organization ${index}`],
      );
    }

    await dataSource.query(
      `INSERT INTO "REPORTS_REPORT_SCHEMAS"
       ("organization_id", "name", "description", "category", "query_definition", "parameters", "is_system", "is_active", "created_by")
       VALUES ($1, $2, 'Existing system row', 'attendance', '{}', '[]', true, true, NULL)`,
      [existingSystemOrganizationId, SYSTEM_REPORT_SCHEMA.name],
    );
    await dataSource.query(
      `INSERT INTO "REPORTS_REPORT_SCHEMAS"
       ("organization_id", "name", "description", "category", "query_definition", "parameters", "is_system", "is_active", "created_by")
       VALUES ($1, $2, 'Custom same-name row', 'custom', '{}', '[]', false, true, NULL)`,
      [customSameNameOrganizationId, SYSTEM_REPORT_SCHEMA.name],
    );

    const migration = new SeedAvgSessionDurationSystemReport1788965263410();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await migration.up(queryRunner);
      await migration.up(queryRunner); // idempotent
    } finally {
      await queryRunner.release();
    }

    const seededRows: Array<{
      organization_id: string;
      is_system: boolean;
      query_definition: Record<string, unknown>;
    }> = await dataSource.query(
      `SELECT "organization_id", "is_system", "query_definition"
         FROM "REPORTS_REPORT_SCHEMAS"
        WHERE "name" = $1
          AND "organization_id" = ANY($2)
        ORDER BY "organization_id", "is_system" DESC`,
      [
        SYSTEM_REPORT_SCHEMA.name,
        [existingSystemOrganizationId, customSameNameOrganizationId],
      ],
    );

    const systemRows = seededRows.filter((row) => row.is_system);
    expect(systemRows).toHaveLength(2);
    expect(systemRows.map((row) => row.organization_id).sort()).toEqual(
      [existingSystemOrganizationId, customSameNameOrganizationId].sort(),
    );
    // An existing system row is never rewritten — the P6-41/P6-43 contract.
    expect(
      systemRows.find((row) => row.organization_id === existingSystemOrganizationId)
        ?.query_definition,
    ).toEqual({});
    expect(
      systemRows.find((row) => row.organization_id === customSameNameOrganizationId)
        ?.query_definition,
    ).toEqual(SYSTEM_REPORT_SCHEMA.query_definition);
    // The custom non-system row is preserved untouched.
    expect(seededRows.filter((row) => !row.is_system)).toHaveLength(1);

    const futureOrganizationId = randomUUID();
    await dataSource.query(
      `INSERT INTO "TENANCY_ORGANIZATIONS" ("id", "name", "timezone", "locale", "currency")
       VALUES ($1, 'P6-38 provisioner organization', 'UTC', 'en-US', 'USD')`,
      [futureOrganizationId],
    );

    await provisionSystemReportSchemas(dataSource.manager, futureOrganizationId);
    await provisionSystemReportSchemas(dataSource.manager, futureOrganizationId);

    const provisionedRows = await dataSource.query(
      `SELECT "query_definition"
         FROM "REPORTS_REPORT_SCHEMAS"
        WHERE "organization_id" = $1
          AND "name" = $2
          AND "is_system" = true`,
      [futureOrganizationId, SYSTEM_REPORT_SCHEMA.name],
    );
    const catalogRow = SYSTEM_REPORT_SCHEMAS.find(
      (schema) => schema.name === SYSTEM_REPORT_SCHEMA.name,
    );
    expect(catalogRow).toBeDefined();
    expect(provisionedRows).toEqual([{ query_definition: catalogRow?.query_definition }]);

    // The migration's copy and the catalog's copy must agree: neither reads the
    // other, so nothing but this assertion keeps them in lockstep.
    expect(SYSTEM_REPORT_SCHEMA.query_definition).toEqual(catalogRow?.query_definition);
  });
});
