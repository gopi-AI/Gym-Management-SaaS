import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P1-03 — Idempotency backstop for membership extensions.
 *
 * Extend is the only new membership action that can compound silently: two
 * "+30 days" calls mean "+60". A client-supplied `idempotency_key` is stored on
 * the history row as
 * `(reference_type = 'extend', reference_id = key)`, and the partial unique
 * index below makes a double-apply impossible even if the service's replay read
 * is bypassed.
 *
 * The index is PARTIAL so every other history transition (create, pause,
 * resume, freeze, unfreeze, cancel, expire, renew, transfer) keeps its existing
 * multiplicity. Both columns are nullable because existing rows have neither.
 */
export class AddMembershipExtendIdempotency1792264431870
  implements MigrationInterface
{
  name = 'AddMembershipExtendIdempotency1792264431870';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" ADD COLUMN "reference_type" character varying(50) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" ADD COLUMN "reference_id" character varying(255) NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_membership_history_extend_key"
       ON "MEMBERSHIPS_MEMBERSHIP_HISTORY" ("membership_id", "reference_type", "reference_id")
       WHERE "reference_type" = 'extend'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_membership_history_extend_key"`);
    await queryRunner.query(
      `ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP COLUMN IF EXISTS "reference_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP COLUMN IF EXISTS "reference_type"`,
    );
  }
}
