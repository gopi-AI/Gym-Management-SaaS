import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import {
  SYSTEM_REPORT_SCHEMA,
  SeedPointsIssuedBurnedSystemReport1788965263407,
} from '../1788965263407-SeedPointsIssuedBurnedSystemReport';
import { SYSTEM_REPORT_SCHEMAS } from '../../reports/constants/system-report-catalog';
import { provisionSystemReportSchemas } from '../../reports/services/system-report-schema-provisioner';

jest.setTimeout(120_000);

const requiredDatabaseEnvironment = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
].every((name) => Boolean(process.env[name]));
const enabled =
  process.env.P6_41_REPORT_INTEGRATION === '1' && requiredDatabaseEnvironment;
const describeDb = enabled ? describe : describe.skip;

describeDb('Points Issued/Burned migration and provisioner PostgreSQL integration', () => {
  let databaseName: string;
  let dataSource: DataSource;

  const connectionOptions = {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT!),
    username: process.env.DB_USERNAME!,
    password: process.env.DB_PASSWORD!,
  };

  beforeAll(async () => {
    databaseName = `gym_p6_41_test_${randomUUID().replace(/-/g, '')}`;
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
    const existingMigrationFiles = readdirSync(migrationsDirectory)
      .filter(
        (file) =>
          /^\d+.*\.(ts|js)$/.test(file) &&
          !file.startsWith('1788965263407-SeedPointsIssuedBurnedSystemReport'),
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

  it('backfills organizations idempotently and provisions the matching catalog row', async () => {
    const existingSystemOrganizationId = randomUUID();
    const customSameNameOrganizationId = randomUUID();
    const emptyOrganizationId = randomUUID();

    for (const [index, organizationId] of [
      existingSystemOrganizationId,
      customSameNameOrganizationId,
      emptyOrganizationId,
    ].entries()) {
      await dataSource.query(
        `INSERT INTO "TENANCY_ORGANIZATIONS" ("id", "name", "timezone", "locale", "currency")
         VALUES ($1, $2, 'UTC', 'en-US', 'USD')`,
        [organizationId, `P6-41 test organization ${index}`],
      );
    }

    await dataSource.query(
      `INSERT INTO "REPORTS_REPORT_SCHEMAS"
       ("organization_id", "name", "description", "category", "query_definition", "parameters", "is_system", "is_active", "created_by")
       VALUES ($1, $2, 'Existing system row', 'loyalty', '{}', '[]', true, true, NULL)`,
      [existingSystemOrganizationId, SYSTEM_REPORT_SCHEMA.name],
    );
    await dataSource.query(
      `INSERT INTO "REPORTS_REPORT_SCHEMAS"
       ("organization_id", "name", "description", "category", "query_definition", "parameters", "is_system", "is_active", "created_by")
       VALUES ($1, $2, 'Custom same-name row', 'custom', '{}', '[]', false, true, NULL)`,
      [customSameNameOrganizationId, SYSTEM_REPORT_SCHEMA.name],
    );

    const migration = new SeedPointsIssuedBurnedSystemReport1788965263407();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await migration.up(queryRunner);
      await migration.up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const backfilledRows: Array<{
      organization_id: string;
      is_system: boolean;
      query_definition: Record<string, unknown>;
    }> = await dataSource.query(
      `SELECT "organization_id", "is_system", "query_definition"
         FROM "REPORTS_REPORT_SCHEMAS"
        WHERE "name" = $1
        ORDER BY "organization_id", "is_system" DESC`,
      [SYSTEM_REPORT_SCHEMA.name],
    );
    const systemRows = backfilledRows.filter((row) => row.is_system);
    expect(systemRows).toHaveLength(3);
    expect(systemRows.map((row) => row.organization_id).sort()).toEqual(
      [
        existingSystemOrganizationId,
        customSameNameOrganizationId,
        emptyOrganizationId,
      ].sort(),
    );

    const existingSystemRow = systemRows.find(
      (row) => row.organization_id === existingSystemOrganizationId,
    );
    expect(existingSystemRow?.query_definition).toEqual({});

    const newlySeededRows = systemRows.filter(
      (row) => row.organization_id !== existingSystemOrganizationId,
    );
    expect(newlySeededRows).toHaveLength(2);
    expect(
      newlySeededRows.every(
        (row) => row.query_definition.source === 'LoyaltyTransaction',
      ),
    ).toBe(true);
    expect(backfilledRows.filter((row) => !row.is_system)).toHaveLength(1);

    const futureOrganizationId = randomUUID();
    await dataSource.query(
      `INSERT INTO "TENANCY_ORGANIZATIONS" ("id", "name", "timezone", "locale", "currency")
       VALUES ($1, 'P6-41 provisioner organization', 'UTC', 'en-US', 'USD')`,
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
  });
});