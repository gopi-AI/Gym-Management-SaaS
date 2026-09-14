import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMembershipSchema1788965263228 implements MigrationInterface {
    name = 'CreateMembershipSchema1788965263228'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // MEMBERSHIPS_MEMBERSHIP_PLANS
        await queryRunner.query(`
            CREATE TABLE "MEMBERSHIPS_MEMBERSHIP_PLANS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "name" character varying(255) NOT NULL,
                "description" text,
                "price" numeric(10,2) NOT NULL,
                "currency" character varying(3) NOT NULL,
                "billing_period" character varying(50) NOT NULL,
                "duration_days" integer NOT NULL,
                "trial_days" integer NOT NULL DEFAULT 0,
                "is_active" boolean NOT NULL DEFAULT true,
                "benefits" jsonb,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_membership_plans" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_membership_plans_organization_id"
            ON "MEMBERSHIPS_MEMBERSHIP_PLANS" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_membership_plans_org_active"
            ON "MEMBERSHIPS_MEMBERSHIP_PLANS" ("organization_id", "is_active")
        `);

        // MEMBERSHIPS_MEMBERSHIPS
        await queryRunner.query(`
            CREATE TABLE "MEMBERSHIPS_MEMBERSHIPS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "member_id" uuid NOT NULL,
                "plan_id" uuid,
                "branch_id" uuid,
                "status" character varying(50) NOT NULL DEFAULT 'active',
                "start_date" date NOT NULL DEFAULT now(),
                "end_date" date,
                "renewal_date" date,
                "cancelled_at" TIMESTAMP WITH TIME ZONE,
                "cancellation_reason" text,
                "paused_at" TIMESTAMP WITH TIME ZONE,
                "pause_end_at" TIMESTAMP WITH TIME ZONE,
                "frozen_at" TIMESTAMP WITH TIME ZONE,
                "price_at_signup" numeric(10,2),
                "currency_at_signup" character varying(3),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_memberships" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_memberships_organization_id"
            ON "MEMBERSHIPS_MEMBERSHIPS" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_memberships_member_id"
            ON "MEMBERSHIPS_MEMBERSHIPS" ("member_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_memberships_plan_id"
            ON "MEMBERSHIPS_MEMBERSHIPS" ("plan_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_memberships_org_status"
            ON "MEMBERSHIPS_MEMBERSHIPS" ("organization_id", "status")
        `);

        // MEMBERSHIPS_MEMBERSHIP_HISTORY
        await queryRunner.query(`
            CREATE TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "membership_id" uuid NOT NULL,
                "organization_id" uuid NOT NULL,
                "member_id" uuid NOT NULL,
                "from_status" character varying(50),
                "to_status" character varying(50) NOT NULL,
                "transition" character varying(100),
                "reason" text,
                "changed_by" uuid,
                "metadata" jsonb,
                "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_membership_history" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_membership_history_membership_id"
            ON "MEMBERSHIPS_MEMBERSHIP_HISTORY" ("membership_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_membership_history_organization_id"
            ON "MEMBERSHIPS_MEMBERSHIP_HISTORY" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_membership_history_occurred_at"
            ON "MEMBERSHIPS_MEMBERSHIP_HISTORY" ("occurred_at")
        `);

        // Foreign keys
        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_PLANS"
            ADD CONSTRAINT "FK_membership_plans_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS"
            ADD CONSTRAINT "FK_memberships_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS"
            ADD CONSTRAINT "FK_memberships_member"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS"
            ADD CONSTRAINT "FK_memberships_plan"
            FOREIGN KEY ("plan_id")
            REFERENCES "MEMBERSHIPS_MEMBERSHIP_PLANS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS"
            ADD CONSTRAINT "FK_memberships_branch"
            FOREIGN KEY ("branch_id")
            REFERENCES "TENANCY_BRANCHES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY"
            ADD CONSTRAINT "FK_membership_history_membership"
            FOREIGN KEY ("membership_id")
            REFERENCES "MEMBERSHIPS_MEMBERSHIPS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY"
            ADD CONSTRAINT "FK_membership_history_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY"
            ADD CONSTRAINT "FK_membership_history_member"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY"
            ADD CONSTRAINT "FK_membership_history_changed_by"
            FOREIGN KEY ("changed_by")
            REFERENCES "IDENTITY_USERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP CONSTRAINT IF EXISTS "FK_membership_history_changed_by"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP CONSTRAINT IF EXISTS "FK_membership_history_member"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP CONSTRAINT IF EXISTS "FK_membership_history_organization"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_HISTORY" DROP CONSTRAINT IF EXISTS "FK_membership_history_membership"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS" DROP CONSTRAINT IF EXISTS "FK_memberships_branch"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS" DROP CONSTRAINT IF EXISTS "FK_memberships_plan"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS" DROP CONSTRAINT IF EXISTS "FK_memberships_member"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIPS" DROP CONSTRAINT IF EXISTS "FK_memberships_organization"`);
        await queryRunner.query(`ALTER TABLE "MEMBERSHIPS_MEMBERSHIP_PLANS" DROP CONSTRAINT IF EXISTS "FK_membership_plans_organization"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "MEMBERSHIPS_MEMBERSHIP_HISTORY"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "MEMBERSHIPS_MEMBERSHIPS"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "MEMBERSHIPS_MEMBERSHIP_PLANS"`);
    }
}