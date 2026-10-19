import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 2 — Create the branch-scoped settings table.
 *
 * `TENANCY_BRANCH_SETTINGS` holds one row per branch. Every column is nullable
 * by design: `null` means "not overridden → inherit from the organization's
 * TenantSettings". This keeps the merge rule one direction (branch wins, else
 * org, else null) with no expansion of the existing org-level
 * `TENANCY_TENANT_SETTINGS` table, whose three NOT NULL columns carry tenant
 * semantics that must not weaken.
 *
 * Reversible: drops the table and its index in reverse order.
 */
export class CreateBranchSettingsTable1792402551252 implements MigrationInterface {
  name = 'CreateBranchSettingsTable1792402551252';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "TENANCY_BRANCH_SETTINGS" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "branch_id" uuid NOT NULL,
      "organization_id" uuid NOT NULL,
      "time_zone" varchar(100),
      "locale" varchar(50),
      "currency" varchar(3),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_branch_settings" PRIMARY KEY ("id")
    )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_branch_settings_branch_org"
       ON "TENANCY_BRANCH_SETTINGS" ("branch_id", "organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_branch_settings_branch_org"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "TENANCY_BRANCH_SETTINGS"`);
  }
}
