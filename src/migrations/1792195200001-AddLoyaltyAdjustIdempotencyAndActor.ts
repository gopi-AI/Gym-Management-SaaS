import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2-08 — Idempotency backstop and actor audit for manual loyalty adjustments.
 *
 * `created_by` records the staff user who performed an `adjust` transaction.
 * It is nullable because every pre-existing ledger row (earn/expire, and any
 * historical rows) has no actor, and the accrual/expiry paths are system
 * writes.
 *
 * `UQ_loyalty_admin_adjust_key` is a PARTIAL unique index: it constrains only
 * `reference_type = 'admin_adjust'` rows, so the pre-existing earn/expire
 * reference types keep their existing multiplicity (the daily cap, not a
 * unique key, governs those). The key tuple is
 * `(account_id, reference_type, reference_id)`, where `reference_id` carries
 * the client-supplied `idempotency_key`. The service also performs a replay
 * read under the account row lock; this index is the DB-level backstop that
 * makes a double-apply impossible even if that read is bypassed.
 */
export class AddLoyaltyAdjustIdempotencyAndActor1792195200001
  implements MigrationInterface
{
  name = 'AddLoyaltyAdjustIdempotencyAndActor1792195200001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LOYALTY_TRANSACTIONS" ADD COLUMN "created_by" uuid NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_loyalty_admin_adjust_key"
       ON "LOYALTY_TRANSACTIONS" ("account_id", "reference_type", "reference_id")
       WHERE "reference_type" = 'admin_adjust'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_loyalty_admin_adjust_key"`);
    await queryRunner.query(
      `ALTER TABLE "LOYALTY_TRANSACTIONS" DROP COLUMN IF EXISTS "created_by"`,
    );
  }
}
