import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Diet schema: diet plans, meal templates, assignments, nutrition logs.
 *
 * All tables use the `DIET_` prefix.
 *
 * Tables created (migration 3248 adds the partial unique index,
 * migration 3249 provisions diet permissions):
 *   - `DIET_DIET_PLANS`              — prescribed diet plans (org-scoped)
 *   - `DIET_MEAL_TEMPLATES`          — reusable meal definitions per plan
 *   - `DIET_DIET_PLAN_ASSIGNMENTS`   — member-plan assignment (Q8)
 *   - `DIET_NUTRITION_LOGS`          — logged meals (Q9/Q10)
 */
export class CreateDietTables1788965263247 implements MigrationInterface {
    name = 'CreateDietTables1788965263247'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // DIET_DIET_PLANS
        await queryRunner.query(`
            CREATE TABLE "DIET_DIET_PLANS" (
                "id"                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"          uuid NOT NULL,
                "name"                     varchar(255) NOT NULL,
                "description"              text,
                "total_calories_per_day"   int,
                "is_active"                boolean NOT NULL DEFAULT true,
                "created_at"               timestamptz NOT NULL DEFAULT now(),
                "updated_at"               timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_DIET_PLANS_ORG_NAME"
            ON "DIET_DIET_PLANS" ("organization_id", "name");
        `);

        // DIET_MEAL_TEMPLATES
        await queryRunner.query(`
            CREATE TABLE "DIET_MEAL_TEMPLATES" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"   uuid NOT NULL,
                "diet_plan_id"      uuid NOT NULL
                                    REFERENCES "DIET_DIET_PLANS"("id")
                                    ON DELETE CASCADE,
                "name"              varchar(255) NOT NULL,
                "meal_type"         varchar(50) NOT NULL,
                "description"       text,
                "calories"          int NOT NULL,
                "protein_g"         decimal(8,2) NOT NULL,
                "carbs_g"           decimal(8,2) NOT NULL,
                "fat_g"             decimal(8,2) NOT NULL,
                "serving_size"      decimal(8,2) NOT NULL,
                "created_at"        timestamptz NOT NULL DEFAULT now(),
                "updated_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_DIET_MEAL_TEMPLATES_ORG_NAME"
            ON "DIET_MEAL_TEMPLATES" ("organization_id", "name");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_DIET_MEAL_TEMPLATES_PLAN"
            ON "DIET_MEAL_TEMPLATES" ("diet_plan_id");
        `);

        // DIET_DIET_PLAN_ASSIGNMENTS
        await queryRunner.query(`
            CREATE TABLE "DIET_DIET_PLAN_ASSIGNMENTS" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"   uuid NOT NULL,
                "member_id"         uuid NOT NULL,
                "diet_plan_id"      uuid NOT NULL
                                    REFERENCES "DIET_DIET_PLANS"("id")
                                    ON DELETE CASCADE,
                "assigned_by"       varchar(100) NOT NULL,
                "assigned_at"       timestamptz NOT NULL DEFAULT now(),
                "start_date"        date NOT NULL,
                "end_date"          date,
                "status"            varchar(50) NOT NULL DEFAULT 'active',
                "created_at"        timestamptz NOT NULL DEFAULT now(),
                "updated_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_DIET_ASSIGNMENTS_ORG_MEMBER_STATUS"
            ON "DIET_DIET_PLAN_ASSIGNMENTS" ("organization_id", "member_id", "status");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_DIET_ASSIGNMENTS_ORG_PLAN"
            ON "DIET_DIET_PLAN_ASSIGNMENTS" ("organization_id", "diet_plan_id");
        `);

        // DIET_NUTRITION_LOGS
        await queryRunner.query(`
            CREATE TABLE "DIET_NUTRITION_LOGS" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"   uuid NOT NULL,
                "member_id"         uuid NOT NULL,
                "assignment_id"     uuid
                                    REFERENCES "DIET_DIET_PLAN_ASSIGNMENTS"("id")
                                    ON DELETE SET NULL,
                "meal_template_id"  uuid
                                    REFERENCES "DIET_MEAL_TEMPLATES"("id")
                                    ON DELETE SET NULL,
                "meal_description"  text,
                "log_date"          date NOT NULL,
                "servings"          int NOT NULL,
                "logged_at"         timestamptz NOT NULL DEFAULT now(),
                "calories"          int,
                "protein_g"         decimal(8,2),
                "carbs_g"           decimal(8,2),
                "fat_g"             decimal(8,2),
                "created_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_DIET_NUTRITION_LOGS_ORG_MEMBER_DATE"
            ON "DIET_NUTRITION_LOGS" ("organization_id", "member_id", "log_date");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_DIET_NUTRITION_LOGS_TEMPLATE"
            ON "DIET_NUTRITION_LOGS" ("meal_template_id");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "DIET_NUTRITION_LOGS" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "DIET_DIET_PLAN_ASSIGNMENTS" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "DIET_MEAL_TEMPLATES" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "DIET_DIET_PLANS" CASCADE;`);
    }
}