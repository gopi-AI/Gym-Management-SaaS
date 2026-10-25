import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converge branch-settings uniqueness on the object migration 1252 already ships.
 *
 * History: an earlier, unmerged draft of the reconciliation chose
 * `UQ_branch_settings_branch_org` as canonical and dropped 1252's
 * `IDX_branch_settings_branch_org`. That choice never shipped: 1252 is merged and
 * immutable and creates the unique index, nothing in the codebase refers to the
 * constraint by name, and `BranchSettingsService.update` resolves the previous row
 * at application level rather than using `ON CONFLICT`. The draft also left the
 * three local scratch databases that ran it with both objects, and those databases
 * already record its migration identity, so editing that file cannot repair them.
 *
 * This migration therefore standardises on 1252's unique index and removes the
 * extra constraint where the draft created it. It is deliberately schema-only: it
 * never creates or drops tables, deletes rows, or provisions permissions.
 *
 * Safety: it verifies that the canonical unique index exists, is valid, and is
 * actually unique before dropping the constraint. If the index is missing,
 * invalid, or non-unique it fails closed rather than leaving the table with no
 * uniqueness guard. On a fresh database (1252 runs first) and on a database that
 * never ran the draft, the drop is a no-op.
 */
export class DropRedundantBranchSettingsUniqueConstraint1792939267116
  implements MigrationInterface
{
  name = 'DropRedundantBranchSettingsUniqueConstraint1792939267116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const canonicalIndex: Array<Record<string, unknown>> = await queryRunner.query(`
      SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_class ix ON ix.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'TENANCY_BRANCH_SETTINGS'
        AND ix.relname = 'IDX_branch_settings_branch_org'
        AND i.indisunique
        AND i.indisvalid
    `);

    if (canonicalIndex.length === 0) {
      throw new Error(
        'Refusing to drop UQ_branch_settings_branch_org: the canonical unique index IDX_branch_settings_branch_org (from migration 1792402551252) is missing, invalid, or non-unique.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "TENANCY_BRANCH_SETTINGS" DROP CONSTRAINT IF EXISTS "UQ_branch_settings_branch_org"`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally empty. Re-adding UQ would restore the drift this migration
    // removes; 1252's unique index is the canonical guard and stays in place.
  }
}
