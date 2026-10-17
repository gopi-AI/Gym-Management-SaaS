import { AddMembershipExtendIdempotency1792264431870 } from '../1792264431870-AddMembershipExtendIdempotency';

describe('AddMembershipExtendIdempotency migration', () => {
  it('adds the reference columns, then the partial unique extend key', async () => {
    const migration = new AddMembershipExtendIdempotency1792264431870();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.up(queryRunner as never);

    expect(migration.name).toBe('AddMembershipExtendIdempotency1792264431870');
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      'ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" ADD COLUMN "reference_type" character varying(50) NULL',
    );
    expect(statements[1]).toContain(
      'ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" ADD COLUMN "reference_id" character varying(255) NULL',
    );

    const index = statements[2];
    expect(index).toContain(
      'CREATE UNIQUE INDEX "UQ_membership_history_extend_key"',
    );
    expect(index).toContain(
      '("membership_id", "reference_type", "reference_id")',
    );
    // The partial predicate is what keeps every other transition out of the
    // unique constraint; without it a membership could have only one history row
    // per type/value combination — and every non-extend row has NULLs.
    expect(index).toContain(`WHERE "reference_type" = 'extend'`);
  });

  it('down() drops the index before the columns', async () => {
    const migration = new AddMembershipExtendIdempotency1792264431870();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "UQ_membership_history_extend_key"',
    );
    expect(statements[1]).toContain(
      'ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP COLUMN IF EXISTS "reference_id"',
    );
    expect(statements[2]).toContain(
      'ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP COLUMN IF EXISTS "reference_type"',
    );
  });
});
