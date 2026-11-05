import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2-05 — reusable workout-day and weekly-plan templates.
 *
 * These are deliberately separate concepts from the legacy flat
 * `WORKOUTS_WORKOUT_TEMPLATES`:
 *   - a day template is one reusable workout composition;
 *   - a plan template is a stable ORDERED sequence of day references and rest
 *     markers (not a fixed weekday calendar).
 *
 * Assignments never reference these tables after snapshotting, so editing or
 * deleting a template cannot change an existing member's plan.
 */
export class CreateWorkoutDayAndPlanTemplates1793000000001
  implements MigrationInterface
{
  name = 'CreateWorkoutDayAndPlanTemplates1793000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_WORKOUT_DAY_TEMPLATES" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "organization_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        "estimated_duration_minutes" int,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_DAY_TEMPLATES_ORG_NAME"
      ON "WORKOUTS_WORKOUT_DAY_TEMPLATES" ("organization_id", "name");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_WORKOUT_DAY_TEMPLATE_EXERCISES" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "day_template_id" uuid NOT NULL,
        "exercise_id" uuid NOT NULL,
        "section" varchar(20) NOT NULL DEFAULT 'strength',
        "sets" int,
        "reps" int,
        "weight_template" decimal(8,2),
        "rest_seconds" int,
        "duration_seconds" int,
        "distance_meters" decimal(10,2),
        "instructions" text,
        "sort_order" int NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_DAY_TEMPLATE_EXERCISES_TEMPLATE"
          FOREIGN KEY ("day_template_id")
          REFERENCES "WORKOUTS_WORKOUT_DAY_TEMPLATES"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_WORKOUTS_DAY_TEMPLATE_EXERCISES_EXERCISE"
          FOREIGN KEY ("exercise_id")
          REFERENCES "WORKOUTS_EXERCISES"("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_DAY_TEMPLATE_EXERCISES_TEMPLATE"
      ON "WORKOUTS_WORKOUT_DAY_TEMPLATE_EXERCISES" ("day_template_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_WORKOUT_PLAN_TEMPLATES" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "organization_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_PLAN_TEMPLATES_ORG_NAME"
      ON "WORKOUTS_WORKOUT_PLAN_TEMPLATES" ("organization_id", "name");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_WORKOUT_PLAN_TEMPLATE_DAYS" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "plan_template_id" uuid NOT NULL,
        "day_template_id" uuid,
        "day_order" int NOT NULL,
        "day_label" varchar(100),
        "is_rest_day" boolean NOT NULL DEFAULT false,
        "is_optional" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_PLAN_TEMPLATE_DAYS_PLAN"
          FOREIGN KEY ("plan_template_id")
          REFERENCES "WORKOUTS_WORKOUT_PLAN_TEMPLATES"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_WORKOUTS_PLAN_TEMPLATE_DAYS_TEMPLATE"
          FOREIGN KEY ("day_template_id")
          REFERENCES "WORKOUTS_WORKOUT_DAY_TEMPLATES"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_WORKOUTS_PLAN_TEMPLATE_DAY_ORDER"
          UNIQUE ("plan_template_id", "day_order")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_PLAN_TEMPLATE_DAYS_PLAN"
      ON "WORKOUTS_WORKOUT_PLAN_TEMPLATE_DAYS" ("plan_template_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_PLAN_TEMPLATE_DAYS" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_PLAN_TEMPLATES" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_DAY_TEMPLATE_EXERCISES" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_DAY_TEMPLATES" CASCADE;`,
    );
  }
}
