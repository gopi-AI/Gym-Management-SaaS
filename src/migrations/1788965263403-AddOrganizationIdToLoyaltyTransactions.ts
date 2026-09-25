import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — add organization_id to LOYALTY_TRANSACTIONS.
 *
 * Implements P6-25's resolution (D) as recorded in
 * docs/phase6-scoping-plan.md §6.7 (:537): the missing column is why *no*
 * `LoyaltyTransaction`-sourced catalog row could be executed, because
 * `ReportExecutorService` appends a tenant filter on the source entity's own
 * `organization_id` (§3.1.1) and `QueryDefinition` has no `joins` key through
 * which the organization could be reached via LOYALTY_ACCOUNTS.
 *
 * Three steps, in this order:
 *
 * 1. Add the column nullable. It cannot be NOT NULL yet: existing rows have no
 *    value.
 * 2. Backfill **deterministically**. LOYALTY_TRANSACTIONS.account_id is
 *    `uuid NOT NULL` with an FK to LOYALTY_ACCOUNTS(id) ON DELETE CASCADE
 *    (1788965263250-AddLoyaltySchema.ts:49-51), and
 *    LOYALTY_ACCOUNTS.organization_id is `uuid NOT NULL` (:22), so every
 *    transaction has exactly one derivable organization and the join resolves
 *    all of them. There is no default, no guess and no heuristic here.
 * 3. Make it NOT NULL, and index it for the tenant-scoped read path §6.7's row
 *    now needs.
 *
 * If the backfill were ever incomplete, step 3 fails with "column contains null
 * values" and TypeORM rolls the whole migration back, because each migration
 * runs in a transaction by default. The failure is therefore loud and atomic
 * rather than a silently-nullable column — no explicit guard clause is added,
 * matching the raw-SQL style of every other migration in this directory.
 *
 * No FK on organization_id: the loyalty tables do not declare one
 * (LOYALTY_ACCOUNTS.organization_id, LOYALTY_RULES.organization_id and
 * LOYALTY_REWARDS.organization_id are all plain `uuid NOT NULL`), so this column
 * matches its own domain rather than introducing a new constraint shape.
 */
export class AddOrganizationIdToLoyaltyTransactions1788965263403 implements MigrationInterface {
    name = 'AddOrganizationIdToLoyaltyTransactions1788965263403'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "LOYALTY_TRANSACTIONS"
            ADD COLUMN "organization_id" uuid;
        `);

        await queryRunner.query(`
            UPDATE "LOYALTY_TRANSACTIONS" AS t
            SET "organization_id" = a."organization_id"
            FROM "LOYALTY_ACCOUNTS" AS a
            WHERE a."id" = t."account_id"
              AND t."organization_id" IS NULL;
        `);

        await queryRunner.query(`
            ALTER TABLE "LOYALTY_TRANSACTIONS"
            ALTER COLUMN "organization_id" SET NOT NULL;
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_TRANSACTIONS_ORG_CREATED"
            ON "LOYALTY_TRANSACTIONS" ("organization_id", "created_at");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_LOYALTY_TRANSACTIONS_ORG_CREATED"`);
        await queryRunner.query(`
            ALTER TABLE "LOYALTY_TRANSACTIONS"
            DROP COLUMN "organization_id";
        `);
    }
}