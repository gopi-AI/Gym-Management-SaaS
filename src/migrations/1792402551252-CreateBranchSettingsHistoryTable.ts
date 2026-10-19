import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 2 — Create the append-only branch settings history table.
 *
 * Mirrors `MEMBERSHIPS_MEMBERSHIP_HISTORY` shape: one row per
 * {@link BranchSettingsService.update} call, with a jsonb {@link changes} diff
 * carrying `{ field: { from, to } }` for every field actually touched. No
 * `reason` column — settings changes carry no required reason in the backlog
 * criteria, so adding one would invent a field the spec does not ask for.
 *
 * Intentionally NOT an outbox record: branch settings changes publish no event
 * today and nothing downstream consumes them (see
 * `docs/event-contracts.md`), so a relational audit table is the correct shape.
 * A `changed_by` uuid is included but nullable (no user attached to background
 * or service-initiated calls).
 *
 * Reversible: drops the table in reverse order.
 */
export class CreateBranchSettingsHistoryTable1792402551252 implements MigrationInterface {
  name = 'CreateBranchSettingsHistoryTable1792402551252';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "TENANCY_BRANCH_SETTINGS_HISTORY" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "branch_id" uuid NOT NULL,
      "organization_id" uuid NOT NULL,
      "changed_by" uuid,
      "changes" jsonb,
      "occurred_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_branch_settings_history" PRIMARY KEY ("id")
    )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_branch_settings_history_branch_org"
       ON "TENANCY_BRANCH_SETTINGS_HISTORY" ("branch_id", "organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "TENANCY_BRANCH_SETTINGS_HISTORY"`);
  }
}
