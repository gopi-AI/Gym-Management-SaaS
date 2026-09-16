import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Partial unique index for diet plan assignments (Q8 backstop).
 *
 * **Backstop** for the app-level check in `DietService.assignPlan()`. It prevents
 * duplicate ACTIVE assignments of the exact same diet plan to the same member
 * while ALLOWING different plans in parallel.
 *
 * Index: `(member_id, diet_plan_id) WHERE status = 'active'`
 *   - Same plan twice + both active → rejected at the DB (real backstop).
 *   - Different plans, both active  → ALLOWED (Q8: multi-plan per member).
 *   - An old 'completed'/'expired' row for the same plan + a new 'active'
 *     row → ALLOWED (the partial predicate only covers 'active' rows).
 *
 * Mirrors the `UQ_workouts_active_assignment` pattern from the workouts schema.
 */
export class CreateDietAssignmentPartialUniqueIndex1788965263248
    implements MigrationInterface
{
    name = 'CreateDietAssignmentPartialUniqueIndex1788965263248'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_diet_active_assignment"
            ON "DIET_DIET_PLAN_ASSIGNMENTS"
            ("member_id", "diet_plan_id")
            WHERE "status" = 'active';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_diet_active_assignment"`,
        );
    }
}