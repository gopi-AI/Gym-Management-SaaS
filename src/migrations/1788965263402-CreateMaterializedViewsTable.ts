import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — REPORTS_MATERIALIZED_VIEWS.
 *
 * The registry of materialized-view definitions. Implements
 * docs/phase6-scoping-plan.md §3.3 (DDL, :279-284).
 *
 * Why this migration exists: the table appeared in docs/database-plan.md only as
 * a Mermaid ERD node — that file holds no SQL for it and no migration created it,
 * so it did not exist in the database before this migration. Phase 6 adopts it as
 * the registry §4.3's endpoints and §7.4's refresh flow operate against, so it has
 * to be created before §7.4's registration INSERTs have anywhere to write (§3.3,
 * :276, :289).
 *
 * The table name is quoted in "REPORTS_MATERIALIZED_VIEWS" form, which §3.3
 * (:289) records as the name this migration must use, matching every other table
 * in the project.
 *
 * No `organization_id`: §3.3 (:287) is explicit that this is a **platform-level
 * registry** of view definitions, not tenant-scoped data. Tenant isolation lives
 * in each materialized view's own organization_id grouping, not here.
 *
 * No unique constraint on `name`: §3.3 specifies none, and §7.4's registration
 * step relies on `name` matching the view's SQL identifier exactly rather than on
 * a constraint enforcing it. Not adding one is deliberate — a unique index on
 * `name` would be a schema decision the plan has not made.
 */
export class CreateMaterializedViewsTable1788965263402 implements MigrationInterface {
    name = 'CreateMaterializedViewsTable1788965263402'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "REPORTS_MATERIALIZED_VIEWS" (
                "id"             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "name"           varchar(200) NOT NULL,
                "description"    text,
                "last_refreshed" timestamptz
            );
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "REPORTS_MATERIALIZED_VIEWS"`);
    }
}