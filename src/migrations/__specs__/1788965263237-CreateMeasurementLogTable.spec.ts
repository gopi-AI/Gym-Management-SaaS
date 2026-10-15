import { CreateMeasurementLogTable1788965263237 } from '../1788965263237-CreateMeasurementLogTable';

describe('CreateMeasurementLogTable migration', () => {
  it('creates the MEMBERS_MEMBER_MEASUREMENTS table with indexes and FK without touching MEMBERS_MEMBERS', async () => {
    const migration = new CreateMeasurementLogTable1788965263237();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.up(queryRunner as never);

    expect(migration.name).toBe('CreateMeasurementLogTable1788965263237');
    expect(statements.some((sql) => sql.includes('CREATE TABLE "MEMBERS_MEMBER_MEASUREMENTS"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('INDEX "IDX_measurements_org_member_type_date"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('INDEX "IDX_measurements_member_id"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('FK_measurements_member_id'))).toBe(true);
    // FK points at MEMBERS_MEMBERS, never at the new table
    expect(statements.some((sql) => sql.includes('REFERENCES "MEMBERS_MEMBERS"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('REFERENCES "MEMBERS_MEMBER_MEASUREMENTS"'))).toBe(false);
  });

  it('down() drops the table, its indexes and its FK', async () => {
    const migration = new CreateMeasurementLogTable1788965263237();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    expect(statements.some((sql) => sql.includes('DROP TABLE "MEMBERS_MEMBER_MEASUREMENTS"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('DROP INDEX "IDX_measurements_org_member_type_date"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('DROP INDEX "IDX_measurements_member_id"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('DROP CONSTRAINT "FK_measurements_member_id"'))).toBe(true);
  });
});
