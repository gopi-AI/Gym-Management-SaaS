import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 2B — AI foundation persistence.
 *
 * Adds the two AI tables required by the first (synchronous, read-only)
 * retention-analysis batch:
 *   - AI_USAGE        : provider token usage / latency / cost telemetry
 *   - AI_AUDIT_EVENTS : tamper-evident audit trail (hash + summaries only)
 *
 * Both tables are organization-scoped with FKs to the existing
 * TENANCY_ORGANIZATIONS and IDENTITY_USERS tables. No prompt, full response,
 * API key, JWT, MFA secret or password hash column exists by design.
 */
export class CreateAiSchema1788965263229 implements MigrationInterface {
    name = 'CreateAiSchema1788965263229'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // AI_USAGE
        await queryRunner.query(`
            CREATE TABLE "AI_USAGE" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "request_type" character varying(100) NOT NULL,
                "provider" character varying(50) NOT NULL,
                "model" character varying(100) NOT NULL,
                "input_tokens" integer NOT NULL DEFAULT 0,
                "output_tokens" integer NOT NULL DEFAULT 0,
                "total_tokens" integer NOT NULL DEFAULT 0,
                "latency_ms" integer NOT NULL DEFAULT 0,
                "estimated_cost_usd" numeric(12,6),
                "success" boolean NOT NULL DEFAULT false,
                "error_code" character varying(100),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ai_usage" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_ai_usage_organization_id" ON "AI_USAGE" ("organization_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_ai_usage_user_id" ON "AI_USAGE" ("user_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_ai_usage_request_type_created_at" ON "AI_USAGE" ("request_type", "created_at")`);
        await queryRunner.query(`CREATE INDEX "IDX_ai_usage_org_created_at" ON "AI_USAGE" ("organization_id", "created_at")`);

        // AI_AUDIT_EVENTS
        await queryRunner.query(`
            CREATE TABLE "AI_AUDIT_EVENTS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "request_type" character varying(100) NOT NULL,
                "provider" character varying(50) NOT NULL,
                "model" character varying(100) NOT NULL,
                "prompt_hash" character varying(64) NOT NULL,
                "prompt_summary" character varying(500) NOT NULL,
                "response_summary" character varying(500),
                "tool_calls" jsonb,
                "input_tokens" integer NOT NULL DEFAULT 0,
                "output_tokens" integer NOT NULL DEFAULT 0,
                "success" boolean NOT NULL DEFAULT false,
                "error_code" character varying(100),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ai_audit_events" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_ai_audit_organization_id" ON "AI_AUDIT_EVENTS" ("organization_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_ai_audit_user_id" ON "AI_AUDIT_EVENTS" ("user_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_ai_audit_request_type" ON "AI_AUDIT_EVENTS" ("request_type")`);
        await queryRunner.query(`CREATE INDEX "IDX_ai_audit_org_created_at" ON "AI_AUDIT_EVENTS" ("organization_id", "created_at")`);

        // Foreign keys to the existing organization / user tables.
        await queryRunner.query(`
            ALTER TABLE "AI_USAGE"
            ADD CONSTRAINT "FK_ai_usage_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "AI_USAGE"
            ADD CONSTRAINT "FK_ai_usage_user"
            FOREIGN KEY ("user_id")
            REFERENCES "IDENTITY_USERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "AI_AUDIT_EVENTS"
            ADD CONSTRAINT "FK_ai_audit_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "AI_AUDIT_EVENTS"
            ADD CONSTRAINT "FK_ai_audit_user"
            FOREIGN KEY ("user_id")
            REFERENCES "IDENTITY_USERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AI_AUDIT_EVENTS" DROP CONSTRAINT IF EXISTS "FK_ai_audit_user"`);
        await queryRunner.query(`ALTER TABLE "AI_AUDIT_EVENTS" DROP CONSTRAINT IF EXISTS "FK_ai_audit_organization"`);
        await queryRunner.query(`ALTER TABLE "AI_USAGE" DROP CONSTRAINT IF EXISTS "FK_ai_usage_user"`);
        await queryRunner.query(`ALTER TABLE "AI_USAGE" DROP CONSTRAINT IF EXISTS "FK_ai_usage_organization"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_audit_org_created_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_audit_request_type"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_audit_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_audit_organization_id"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "AI_AUDIT_EVENTS"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_usage_org_created_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_usage_request_type_created_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_usage_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ai_usage_organization_id"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "AI_USAGE"`);
    }
}
