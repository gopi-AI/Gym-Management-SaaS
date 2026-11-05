import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2-05 — plan-day submissions/reviews and 30–45-day progress reviews.
 *
 * Submissions and reviews are append-only historical rows. A day may receive
 * several submissions and several reviews over time; nothing is overwritten.
 * Progress reviews snapshot the counts, the attendance aggregate and the
 * measurements used, so later changes cannot rewrite a past review.
 */
export class CreateWorkoutReviews1793000000004 implements MigrationInterface {
  name = 'CreateWorkoutReviews1793000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_PLAN_DAY_SUBMISSIONS" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "organization_id" uuid NOT NULL,
        "prescribed_day_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "submitted_by" uuid,
        "submitted_at" timestamptz NOT NULL DEFAULT now(),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_SUBMISSIONS_DAY"
          FOREIGN KEY ("prescribed_day_id")
          REFERENCES "WORKOUTS_PRESCRIBED_DAYS"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_SUBMISSIONS_ORG_DAY"
      ON "WORKOUTS_PLAN_DAY_SUBMISSIONS" ("organization_id", "prescribed_day_id", "submitted_at");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "submission_id" uuid NOT NULL,
        "prescribed_day_exercise_id" uuid NOT NULL,
        "completed" boolean,
        "sets_completed" int,
        "reps_completed" int,
        "weight_used" decimal(8,2),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_SUBMISSION_EXERCISES_SUBMISSION"
          FOREIGN KEY ("submission_id")
          REFERENCES "WORKOUTS_PLAN_DAY_SUBMISSIONS"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_WORKOUTS_SUBMISSION_EXERCISES_PRESCRIBED"
          FOREIGN KEY ("prescribed_day_exercise_id")
          REFERENCES "WORKOUTS_PRESCRIBED_DAY_EXERCISES"("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_SUBMISSION_EXERCISES_SUBMISSION"
      ON "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES" ("submission_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_SUBMISSION_EXERCISES_PRESCRIBED"
      ON "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES" ("prescribed_day_exercise_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_PLAN_DAY_REVIEWS" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "organization_id" uuid NOT NULL,
        "prescribed_day_id" uuid NOT NULL,
        "submission_id" uuid,
        "reviewed_by" uuid,
        "decision" varchar(30) NOT NULL,
        "notes" text,
        "decided_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_PLAN_DAY_REVIEWS_DAY"
          FOREIGN KEY ("prescribed_day_id")
          REFERENCES "WORKOUTS_PRESCRIBED_DAYS"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_WORKOUTS_PLAN_DAY_REVIEWS_SUBMISSION"
          FOREIGN KEY ("submission_id")
          REFERENCES "WORKOUTS_PLAN_DAY_SUBMISSIONS"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_PLAN_DAY_REVIEWS_ORG_DAY"
      ON "WORKOUTS_PLAN_DAY_REVIEWS" ("organization_id", "prescribed_day_id", "decided_at");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_PROGRESS_REVIEWS" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "organization_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "assignment_id" uuid NOT NULL,
        "review_date" date NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "approved_days" int NOT NULL,
        "prescribed_days" int NOT NULL,
        "progress_percentage" int NOT NULL,
        "plan_day_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "attendance_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "results" text,
        "fitness_improvements" text,
        "goal_assessment" text,
        "observations" text,
        "recommendations" text,
        "decision" varchar(20) NOT NULL,
        "reviewed_by" uuid,
        "resulting_assignment_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_PROGRESS_REVIEWS_ASSIGNMENT"
          FOREIGN KEY ("assignment_id")
          REFERENCES "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_WORKOUTS_PROGRESS_REVIEWS_RESULTING"
          FOREIGN KEY ("resulting_assignment_id")
          REFERENCES "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_PROGRESS_REVIEWS_ORG_MEMBER_DATE"
      ON "WORKOUTS_PROGRESS_REVIEWS" ("organization_id", "member_id", "review_date");
    `);

    await queryRunner.query(`
      CREATE TABLE "WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "review_id" uuid NOT NULL,
        "measurement_id" uuid NOT NULL,
        "measurement_type" varchar(50) NOT NULL,
        "value" decimal(8,2) NOT NULL,
        "unit" varchar(10) NOT NULL,
        "measured_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_WORKOUTS_REVIEW_MEASUREMENTS_REVIEW"
          FOREIGN KEY ("review_id")
          REFERENCES "WORKOUTS_PROGRESS_REVIEWS"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_WORKOUTS_REVIEW_MEASUREMENTS_MEASUREMENT"
          FOREIGN KEY ("measurement_id")
          REFERENCES "MEMBERS_MEMBER_MEASUREMENTS"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_WORKOUTS_REVIEW_MEASUREMENT"
          UNIQUE ("review_id", "measurement_id")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_REVIEW_MEASUREMENTS_REVIEW"
      ON "WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS" ("review_id");
    `);

    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        ADD CONSTRAINT "FK_WORKOUTS_ASSIGNMENT_PROGRESS_REVIEW"
        FOREIGN KEY ("progress_review_id")
        REFERENCES "WORKOUTS_PROGRESS_REVIEWS"("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
        DROP CONSTRAINT IF EXISTS "FK_WORKOUTS_ASSIGNMENT_PROGRESS_REVIEW";
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_PROGRESS_REVIEWS" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_PLAN_DAY_REVIEWS" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES" CASCADE;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "WORKOUTS_PLAN_DAY_SUBMISSIONS" CASCADE;`,
    );
  }
}
