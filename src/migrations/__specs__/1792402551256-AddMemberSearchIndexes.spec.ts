import { AddMemberSearchIndexes1792402551256 } from '../1792402551256-AddMemberSearchIndexes';

describe('AddMemberSearchIndexes migration', () => {
  it('creates the three btree indexes on MEMBERS_MEMBERS', async () => {
    const migration = new AddMemberSearchIndexes1792402551256();
    const statements: string[] = [];
    const queryRunner = { query: jest.fn(async (sql: string) => { statements.push(sql); }) };

    await migration.up(queryRunner as never);

    expect(migration.name).toBe('AddMemberSearchIndexes1792402551256');
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      'CREATE INDEX "IDX_members_members_organization_id" ON "MEMBERS_MEMBERS" ("organization_id")',
    );
    expect(statements[1]).toContain(
      'CREATE INDEX "IDX_members_members_organization_id_email" ON "MEMBERS_MEMBERS" ("organization_id", "email")',
    );
    expect(statements[2]).toContain(
      'CREATE INDEX "IDX_members_members_organization_id_phone" ON "MEMBERS_MEMBERS" ("organization_id", "phone")',
    );
  });

  it('down() drops the indexes in reverse order', async () => {
    const migration = new AddMemberSearchIndexes1792402551256();
    const statements: string[] = [];
    const queryRunner = { query: jest.fn(async (sql: string) => { statements.push(sql); }) };

    await migration.down(queryRunner as never);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "IDX_members_members_organization_id_phone"',
    );
    expect(statements[1]).toContain(
      'DROP INDEX IF EXISTS "IDX_members_members_organization_id_email"',
    );
    expect(statements[2]).toContain(
      'DROP INDEX IF EXISTS "IDX_members_members_organization_id"',
    );
  });
});