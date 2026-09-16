import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Loyalty schema.
 *
 * Tables created (per docs/phase2-scoping-plan.md §5):
 *   - LOYALTY_ACCOUNTS       — per-member-per-org points balance
 *   - LOYALTY_TRANSACTIONS   — append-only points ledger
 *   - LOYALTY_RULES          — configurable earning rules
 *   - LOYALTY_REWARDS        — schema-only seat-filler (unused in Phase 2)
 *
 * All tables use the `LOYALTY_` prefix, consistent with other modules.
 */
export class AddLoyaltySchema1788965263250 implements MigrationInterface {
    name = 'AddLoyaltySchema1788965263250'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // LOYALTY_ACCOUNTS
        await queryRunner.query(`
            CREATE TABLE "LOYALTY_ACCOUNTS" (
                "id"                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"          uuid NOT NULL,
                "member_id"                uuid NOT NULL,
                "balance"                  int NOT NULL DEFAULT 0,
                "lifetime_points_earned"   int NOT NULL DEFAULT 0,
                "lifetime_points_redeemed" int NOT NULL DEFAULT 0,
                "tier"                     varchar(50),
                "created_at"               timestamptz NOT NULL DEFAULT now(),
                "updated_at"               timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_LOYALTY_ACCOUNTS_ORG_MEMBER"
            ON "LOYALTY_ACCOUNTS" ("organization_id", "member_id");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_ACCOUNTS_ORG"
            ON "LOYALTY_ACCOUNTS" ("organization_id");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_ACCOUNTS_MEMBER"
            ON "LOYALTY_ACCOUNTS" ("member_id");
        `);

        // LOYALTY_TRANSACTIONS
        await queryRunner.query(`
            CREATE TABLE "LOYALTY_TRANSACTIONS" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "account_id"        uuid NOT NULL
                                    REFERENCES "LOYALTY_ACCOUNTS"("id")
                                    ON DELETE CASCADE,
                "transaction_type"  varchar(20) NOT NULL
                                    CHECK ("transaction_type" IN ('earn','adjust','expire','redeem')),
                "points"            int NOT NULL,
                "remaining_points"  int NOT NULL,
                "reference_type"    varchar(50),
                "reference_id"      varchar(255),
                "description"       text,
                "expires_at"        timestamptz,
                "created_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_TRANSACTIONS_ACCOUNT_CREATED"
            ON "LOYALTY_TRANSACTIONS" ("account_id", "created_at");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_TRANSACTIONS_ACCOUNT_EXPIRES"
            ON "LOYALTY_TRANSACTIONS" ("account_id", "expires_at");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_TRANSACTIONS_EXPIRES_REMAINING"
            ON "LOYALTY_TRANSACTIONS" ("expires_at", "remaining_points");
        `);

        // LOYALTY_RULES
        await queryRunner.query(`
            CREATE TABLE "LOYALTY_RULES" (
                "id"               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"  uuid NOT NULL,
                "name"             varchar(100) NOT NULL,
                "trigger_event"    varchar(30) NOT NULL
                                   CHECK ("trigger_event" IN ('check_in','workout_logged')),
                "points_per_event" int NOT NULL,
                "max_per_day"      int NOT NULL DEFAULT 1,
                "is_active"        boolean NOT NULL DEFAULT true,
                "created_at"       timestamptz NOT NULL DEFAULT now(),
                "updated_at"       timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_RULES_ORG_TRIGGER"
            ON "LOYALTY_RULES" ("organization_id", "trigger_event", "is_active");
        `);

        // LOYALTY_REWARDS (schema-only in Phase 2)
        await queryRunner.query(`
            CREATE TABLE "LOYALTY_REWARDS" (
                "id"               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"  uuid NOT NULL,
                "name"             varchar(100) NOT NULL,
                "description"      text,
                "points_cost"      int NOT NULL,
                "reward_type"      varchar(30) NOT NULL
                                   CHECK ("reward_type" IN ('discount','item','free_session')),
                "is_active"        boolean NOT NULL DEFAULT true,
                "valid_from"       timestamptz,
                "valid_to"         timestamptz,
                "stock"            int,
                "created_at"       timestamptz NOT NULL DEFAULT now(),
                "updated_at"       timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_LOYALTY_REWARDS_ORG_ACTIVE"
            ON "LOYALTY_REWARDS" ("organization_id", "is_active");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "LOYALTY_REWARDS"`);
        await queryRunner.query(`DROP TABLE "LOYALTY_RULES"`);
        await queryRunner.query(`DROP TABLE "LOYALTY_TRANSACTIONS"`);
        await queryRunner.query(`DROP TABLE "LOYALTY_ACCOUNTS"`);
    }
}