import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2-05 — workout-session lifecycle, linkage and soft deletion.
 *
 * Existing session rows predate the lifecycle: they were logged with no status
 * concept, so every pre-existing row is backfilled to `finished` (view-only).
 * No session is deleted or re-dated. Existing session-exercise rows get
 * `completed = NULL` because the old model had no checkbox.
 */
export class ExtendWorkoutSessionsForP2051793000000003
  implements MigrationInterface
{
  name = 'ExtendWorkoutSessionsForP2051793000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSIONS"
        ADD COLUMN "prescribed_day_id" uuid,
        ADD COLUMN "status" varchar(20) NOT NULL DEFAULT 'in_progress',
        ADD COLUMN "created_by" uuid,
        ADD COLUMN "cancelled_at" timestamptz,
        ADD COLUMN "deleted_at" timestamptz,
        ADD COLUMN "deleted_by" uuid,
        ADD COLUMN "updated_at" timestamptz NOT NULL DEFAULT now();
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSIONS"
        ADD CONSTRAINT "FK_WORKOUTS_SESSIONS_PRESCRIBED_DAY"
        FOREIGN KEY ("prescribed_day_id")
        REFERENCES "WORKOUTS_PRESCRIBED_DAYS"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_SESSIONS_PRESCRIBED_DAY"
      ON "WORKOUTS_WORKOUT_SESSIONS" ("prescribed_day_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_SESSIONS_ORG_MEMBER_STATUS"
      ON "WORKOUTS_WORKOUT_SESSIONS" ("organization_id", "member_id", "status");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_SESSIONS_ORG_MEMBER_DELETED"
      ON "WORKOUTS_WORKOUT_SESSIONS" ("organization_id", "member_id", "deleted_at");
    `);

    // Every existing row was written before the lifecycle existed. Treating it
    // as finished preserves its history and locks it against new edits.
    await queryRunner.query(`
      UPDATE "WORKOUTS_WORKOUT_SESSIONS"
      SET "status" = 'finished'
      WHERE "status" = 'in_progress';
    `);

    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSION_EXERCISES"
        ADD COLUMN "prescribed_day_exercise_id" uuid,
        ADD COLUMN "completed" boolean;
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSION_EXERCISES"
        ADD CONSTRAINT "FK_WORKOUTS_SESSION_EXERCISES_PRESCRIBED"
        FOREIGN KEY ("prescribed_day_exercise_id")
        REFERENCES "WORKOUTS_PRESCRIBED_DAY_EXERCISES"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_WORKOUTS_SESSION_EXERCISES_PRESCRIBED"
      ON "WORKOUTS_WORKOUT_SESSION_EXERCISES" ("prescribed_day_exercise_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_WORKOUTS_SESSION_EXERCISES_PRESCRIBED";`,
    );
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSION_EXERCISES"
        DROP CONSTRAINT IF EXISTS "FK_WORKOUTS_SESSION_EXERCISES_PRESCRIBED";
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSION_EXERCISES"
        DROP COLUMN "completed",
        DROP COLUMN "prescribed_day_exercise_id";
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_WORKOUTS_SESSIONS_ORG_MEMBER_DELETED";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_WORKOUTS_SESSIONS_ORG_MEMBER_STATUS";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_WORKOUTS_SESSIONS_PRESCRIBED_DAY";`,
    );
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSIONS"
        DROP CONSTRAINT IF EXISTS "FK_WORKOUTS_SESSIONS_PRESCRIBED_DAY";
    `);
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_WORKOUT_SESSIONS"
        DROP COLUMN "updated_at",
        DROP COLUMN "deleted_by",
        DROP COLUMN "deleted_at",
        DROP COLUMN "cancelled_at",
        DROP COLUMN "created_by",
        DROP COLUMN "status",
        DROP COLUMN "prescribed_day_id";
    `);
  }
}
