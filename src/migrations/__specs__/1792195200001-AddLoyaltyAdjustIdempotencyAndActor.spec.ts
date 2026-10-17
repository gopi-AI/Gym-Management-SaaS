import { AddLoyaltyAdjustIdempotencyAndActor1792195200001 } from '../1792195200001-AddLoyaltyAdjustIdempotencyAndActor';

describe('AddLoyaltyAdjustIdempotencyAndActor migration', () => {
  it('adds created_by, then the partial unique adjust key', async () => {
    const migration = new AddLoyaltyAdjustIdempotencyAndActor1792195200001();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.up(queryRunner as never);

    expect(migration.name).toBe('AddLoyaltyAdjustIdempotencyAndActor1792195200001');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      'ALTER TABLE "LOYALTY_TRANSACTIONS" ADD COLUMN "created_by" uuid NULL',
    );

    const index = statements[1];
    expect(index).toContain(
      'CREATE UNIQUE INDEX "UQ_loyalty_admin_adjust_key"',
    );
    expect(index).toContain(
      '("account_id", "reference_type", "reference_id")',
    );
    // The partial predicate is what keeps earn/expire rows out of the unique
    // constraint; without it the pre-existing reference types could collide.
    expect(index).toContain(`WHERE "reference_type" = 'admin_adjust'`);
  });

  it('down() drops the index before the column', async () => {
    const migration = new AddLoyaltyAdjustIdempotencyAndActor1792195200001();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(
      'DROP INDEX IF EXISTS "UQ_loyalty_admin_adjust_key"',
    );
    expect(statements[1]).toContain(
      'ALTER TABLE "LOYALTY_TRANSACTIONS" DROP COLUMN IF EXISTS "created_by"',
    );
  });
});
