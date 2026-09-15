import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Partial unique index for workout plan assignments.
 *
 * **Backstop** for the app-level check in `WorkoutsService.assignPlan()` (Q6
 * belt-and-suspenders). It prevents duplicate ACTIVE assignments of the exact same
 * template to the same member while ALLOWING different templates in parallel.
 *
 * Index: `(member_id, template_id) WHERE status = 'active'`
 *   - Same template twice + both active → rejected at the DB (real backstop).
 *   - Different templates, both active  → ALLOWED (Q6: multi-plan per member).
 *   - An old 'completed'/'expired' row for the same template + a new 'active'
 *     row → ALLOWED (the partial predicate only covers 'active' rows).
 *
 * Mirrors the `UQ_attendance_open_record` partial-index pattern from the
 * attendance schema.
 */
export class CreateWorkoutAssignmentPartialUniqueIndex1788965263243
    implements MigrationInterface
{
    name = 'CreateWorkoutAssignmentPartialUniqueIndex1788965263243'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_workouts_active_assignment"
            ON "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS"
            ("member_id", "template_id")
            WHERE "status" = 'active';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_workouts_active_assignment"`,
        );
    }
}