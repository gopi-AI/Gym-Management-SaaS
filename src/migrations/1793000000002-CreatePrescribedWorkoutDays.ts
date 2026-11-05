import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2-05 — assignment-specific prescribed-day snapshots.
 *
 * An assignment now has either a legacy flat `template_id` or a
 * `plan_template_id`. At assignment time the plan's days and prescriptions are
 * copied into `WORKOUTS_PRESCRIBED_DAYS` / `WORKOUTS_PRESCRIBED_DAY_EXERCISES`;
 * the reusable template is not read again for that member.
 *
 * Existing assignments are backfilled compatibly: each distinct
 * `COALESCE(day_of_week, 0)` group in the legacy template becomes one pending
 * prescribed day, and its exercise rows are copied with the exercise name
 * snapshot. No approval is invented — legacy progress starts at 0 approved
 * days, and legacy sessions stay unlinked (they predate prescribed days).
 */
export class CreatePrescribedWorkoutDays1793000000002
  implements MigrationInterface
{
  name = 'CreatePrescribedWorkoutDays1793000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -- Assignment source + snapshot metadata ------------------------------
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        ADD COLUMN "plan_template_id" uuid,
        ADD COLUMN "logging_mode" varchar(20) NOT NULL DEFAULT 'simple',
        ADD COLUMN "snapshot_taken_at" timestamptz,
        ADD COLUMN "progress_review_id" uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        ALTER COLUMN "template_id" DROP NOT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        ADD CONSTRAINT "CHK_WORKOUTS_ASSIGNMENT_SOURCE"
        CHECK ("template_id" IS NOT NULL OR "plan_template_id" IS NOT NULL);
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        ADD CONSTRAINT "FK_WORKOUTS_ASSIGNMENT_PLAN_TEMPLATE"
        FOREIGN KEY ("plan_template_id")
        REFERENCES "WORKOUTS_WORKOUT_PLAN_TEMPLATES"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_ASSIGNMENTS_ORG_PLAN_TEMPLATE"
      ON "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" ("organization_id", "plan_template_id");
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_WORKOUTS_ACTIVE_PLAN_TEMPLATE_ASSIGNMENT"
      ON "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" ("member_id", "plan_template_id")
      WHERE "status" = 'active' AND "plan_template_id" IS NOT NULL;
    `);

    // -- Prescribed days and their exercise snapshots -----------------------
    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_PRESCRIBED_DAYS" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "organization_id" uuid NOT NULL,
        "assignment_id" uuid NOT NULL,
        "sequence_order" int NOT NULL,
        "source_day_template_id" uuid,
        "name" varchar(255) NOT NULL,
        "day_label" varchar(100),
        "is_rest_day" boolean NOT NULL DEFAULT false,
        "is_optional" boolean NOT NULL DEFAULT false,
        "status" varchar(30) NOT NULL DEFAULT 'pending',
        "submitted_at" timestamptz,
        "approved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_PRESCRIBED_DAYS_ASSIGNMENT"
          FOREIGN KEY ("assignment_id")
          REFERENCES "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_WORKOUTS_PRESCRIBED_DAYS_SOURCE_TEMPLATE"
          FOREIGN KEY ("source_day_template_id")
          REFERENCES "WORKOUTS_WORKOUT_DAY_TEMPLATES"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_WORKOUTS_PRESCRIBED_DAY_ORDER"
          UNIQUE ("assignment_id", "sequence_order")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_PRESCRIBED_DAYS_ORG_ASSIGNMENT_STATUS"
      ON "WORKOUTS_PRESCRIBED_DAYS" ("organization_id", "assignment_id", "status");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_PRESCRIBED_DAY_EXERCISES" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "prescribed_day_id" uuid NOT NULL,
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
        "exercise_name_snapshot" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_PRESCRIBED_EXERCISES_DAY"
          FOREIGN KEY ("prescribed_day_id")
          REFERENCES "WORKOUTS_PRESCRIBED_DAYS"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_WORKOUTS_PRESCRIBED_EXERCISES_EXERCISE"
          FOREIGN KEY ("exercise_id")
          REFERENCES "WORKOUTS_EXERCISES"("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_PRESCRIBED_EXERCISES_DAY"
      ON "WORKOUTS_PRESCRIBED_DAY_EXERCISES" ("prescribed_day_id");
    `);

    // -- Backfill existing legacy assignments ------------------------------
    await queryRunner.query(`
      INSERT INTO "WORKOUTS_PRESCRIBED_DAYS" (
        "id", "organization_id", "assignment_id", "sequence_order",
        "source_day_template_id", "name", "day_label", "is_rest_day",
        "is_optional", "status", "created_at", "updated_at"
      )
      SELECT
        gen_random_uuid(),
        a."organization_id",
        a."id",
        day_keys."day_key" + 1,
        NULL,
        t."name" || ' - Day ' || (day_keys."day_key" + 1),
        NULL,
        false,
        false,
        'pending',
        now(),
        now()
      FROM "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" a
      INNER JOIN "WORKOUTS_WORKOUT_TEMPLATES" t
        ON t."id" = a."template_id"
      INNER JOIN (
        SELECT "template_id", COALESCE("day_of_week", 0) AS "day_key"
        FROM "WORKOUTS_WORKOUT_TEMPLATE_EXERCISES"
        GROUP BY "template_id", COALESCE("day_of_week", 0)
      ) day_keys ON day_keys."template_id" = a."template_id"
      WHERE a."template_id" IS NOT NULL;
    `);

    await queryRunner.query(`
      INSERT INTO "WORKOUTS_PRESCRIBED_DAY_EXERCISES" (
        "id", "prescribed_day_id", "exercise_id", "section", "sets", "reps",
        "weight_template", "rest_seconds", "duration_seconds",
        "distance_meters", "instructions", "sort_order",
        "exercise_name_snapshot", "created_at"
      )
      SELECT
        gen_random_uuid(),
        pd."id",
        te."exercise_id",
        'strength',
        te."sets",
        te."reps",
        te."weight_template",
        te."rest_seconds",
        NULL,
        NULL,
        NULL,
        te."sort_order",
        e."name",
        now()
      FROM "WORKOUTS_PRESCRIBED_DAYS" pd
      INNER JOIN "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" a
        ON a."id" = pd."assignment_id"
      INNER JOIN "WORKOUTS_WORKOUT_TEMPLATE_EXERCISES" te
        ON te."template_id" = a."template_id"
       AND COALESCE(te."day_of_week", 0) + 1 = pd."sequence_order"
      INNER JOIN "WORKOUTS_EXERCISES" e
        ON e."id" = te."exercise_id"
      WHERE a."template_id" IS NOT NULL
        AND pd."source_day_template_id" IS NULL;
    `);

    await queryRunner.query(`
      UPDATE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
      SET "snapshot_taken_at" = "assigned_at"
      WHERE "snapshot_taken_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_PRESCRIBED_DAY_EXERCISES" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_PRESCRIBED_DAYS" CASCADE;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_WORKOUTS_ACTIVE_PLAN_TEMPLATE_ASSIGNMENT";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_WORKOUTS_ASSIGNMENTS_ORG_PLAN_TEMPLATE";`,
    );
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        DROP CONSTRAINT IF EXISTS "FK_WORKOUTS_ASSIGNMENT_PLAN_TEMPLATE";
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        DROP CONSTRAINT IF EXISTS "CHK_WORKOUTS_ASSIGNMENT_SOURCE";
    `);
    // Plan-template assignments only exist because of this migration; removing
    // them is what makes restoring the NOT NULL template_id safe on revert.
    await queryRunner.query(
      `DELETE FROM "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" WHERE "template_id" IS NULL;`,
    );
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        ALTER COLUMN "template_id" SET NOT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        DROP COLUMN "progress_review_id",
        DROP COLUMN "snapshot_taken_at",
        DROP COLUMN "logging_mode",
        DROP COLUMN "plan_template_id";
    `);
  }
}
