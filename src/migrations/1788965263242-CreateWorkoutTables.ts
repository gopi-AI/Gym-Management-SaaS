import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Workouts schema: exercises, templates, assignments, sessions.
 *
 * All tables use the `WORKOUTS_` prefix. The naming collision with the PT
 * module (§11 Risk 1) is resolved by Workouts owning ALL exercise content
 * and PT calling `WorkoutsService.assignPlan()` — no PT-exercise or
 * PT-plan tables exist.
 *
 * Tables created (migration 3243 adds the partial unique index):
 *   - `WORKOUTS_EXERCISES`           — org-scoped exercise library (Q5)
 *   - `WORKOUTS_WORKOUT_TEMPLATES`   — reusable exercise collections
 *   - `WORKOUTS_WORKOUT_TEMPLATE_EXERCISES` — join with sets/reps/order
 *   - `WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS`   — member-template assignment (Q6)
 *   - `WORKOUTS_WORKOUT_SESSIONS`           — logged workout instances
 *   - `WORKOUTS_WORKOUT_SESSION_EXERCISES`  — per-exercise session log
 */
export class CreateWorkoutTables1788965263242 implements MigrationInterface {
    name = 'CreateWorkoutTables1788965263242'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // WORKOUTS_EXERCISES
        await queryRunner.query(`
            CREATE TABLE "WORKOUTS_EXERCISES" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"   uuid NOT NULL,
                "name"              varchar(255) NOT NULL,
                "description"       text,
                "category"          varchar(50),
                "muscle_group"      varchar(100),
                "equipment_needed"  varchar(100),
                "is_active"         boolean NOT NULL DEFAULT true,
                "created_at"        timestamptz NOT NULL DEFAULT now(),
                "updated_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_WORKOUTS_EXERCISES_ORG_NAME"
            ON "WORKOUTS_EXERCISES" ("organization_id", "name");
        `);

        // WORKOUTS_WORKOUT_TEMPLATES
        await queryRunner.query(`
            CREATE TABLE "WORKOUTS_WORKOUT_TEMPLATES" (
                "id"                        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"           uuid NOT NULL,
                "name"                      varchar(255) NOT NULL,
                "description"               text,
                "difficulty_level"          varchar(50),
                "estimated_duration_minutes" int,
                "is_active"                 boolean NOT NULL DEFAULT true,
                "created_at"                timestamptz NOT NULL DEFAULT now(),
                "updated_at"                timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_WORKOUTS_TEMPLATES_ORG_NAME"
            ON "WORKOUTS_WORKOUT_TEMPLATES" ("organization_id", "name");
        `);

        // WORKOUTS_WORKOUT_TEMPLATE_EXERCISES
        await queryRunner.query(`
            CREATE TABLE "WORKOUTS_WORKOUT_TEMPLATE_EXERCISES" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "template_id"       uuid NOT NULL
                                    REFERENCES "WORKOUTS_WORKOUT_TEMPLATES"("id")
                                    ON DELETE CASCADE,
                "exercise_id"       uuid NOT NULL
                                    REFERENCES "WORKOUTS_EXERCISES"("id")
                                    ON DELETE RESTRICT,
                "sets"              int,
                "reps"              int,
                "weight_template"   decimal(8,2),
                "rest_seconds"      int,
                "sort_order"        int NOT NULL,
                "day_of_week"       int,
                "created_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);

        // WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS (partial unique index added in 3243)
        await queryRunner.query(`
            CREATE TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"   uuid NOT NULL,
                "member_id"         uuid NOT NULL,
                "template_id"       uuid NOT NULL,
                "assigned_by"       varchar(100) NOT NULL,
                "assigned_at"       timestamptz NOT NULL DEFAULT now(),
                "start_date"        date NOT NULL,
                "end_date"          date,
                "status"            varchar(20) NOT NULL DEFAULT 'active',
                "notes"             text,
                "created_at"        timestamptz NOT NULL DEFAULT now(),
                "updated_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_WORKOUTS_ASSIGNMENTS_ORG_MEMBER_STATUS"
            ON "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" ("organization_id", "member_id", "status");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_WORKOUTS_ASSIGNMENTS_ORG_TEMPLATE"
            ON "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" ("organization_id", "template_id");
        `);

        // WORKOUTS_WORKOUT_SESSIONS
        await queryRunner.query(`
            CREATE TABLE "WORKOUTS_WORKOUT_SESSIONS" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"   uuid NOT NULL,
                "member_id"         uuid NOT NULL,
                "template_id"       uuid
                                    REFERENCES "WORKOUTS_WORKOUT_TEMPLATES"("id")
                                    ON DELETE SET NULL,
                "assignment_id"     uuid
                                    REFERENCES "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"("id")
                                    ON DELETE SET NULL,
                "session_date"      date NOT NULL,
                "started_at"        timestamptz,
                "completed_at"      timestamptz,
                "duration_minutes"  int,
                "notes"             text,
                "mood"              int,
                "created_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_WORKOUTS_SESSIONS_ORG_MEMBER_DATE"
            ON "WORKOUTS_WORKOUT_SESSIONS" ("organization_id", "member_id", "session_date");
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_WORKOUTS_SESSIONS_ASSIGNMENT"
            ON "WORKOUTS_WORKOUT_SESSIONS" ("assignment_id");
        `);

        // WORKOUTS_WORKOUT_SESSION_EXERCISES
        await queryRunner.query(`
            CREATE TABLE "WORKOUTS_WORKOUT_SESSION_EXERCISES" (
                "id"                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "session_id"        uuid NOT NULL
                                    REFERENCES "WORKOUTS_WORKOUT_SESSIONS"("id")
                                    ON DELETE CASCADE,
                "exercise_id"       uuid NOT NULL
                                    REFERENCES "WORKOUTS_EXERCISES"("id")
                                    ON DELETE RESTRICT,
                "sets_completed"    int,
                "reps_completed"    int,
                "weight_used"       decimal(8,2),
                "rpe"               int,
                "notes"             text,
                "created_at"        timestamptz NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_WORKOUTS_SESSION_EXERCISES_SESSION"
            ON "WORKOUTS_WORKOUT_SESSION_EXERCISES" ("session_id");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_SESSION_EXERCISES" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_SESSIONS" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_TEMPLATE_EXERCISES" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_TEMPLATES" CASCADE;`);
        await queryRunner.query(`DROP TABLE IF EXISTS "WORKOUTS_EXERCISES" CASCADE;`);
    }
}