import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — REPORTS_REPORT_JOBS.
 *
 * One row per report execution (async job). Implements
 * docs/phase6-scoping-plan.md §3.2 (DDL, :245-267).
 *
 * `status` is the job state machine: 'pending' | 'running' | 'completed' |
 * 'failed' | 'cancelled' (§3.2). `result_*` columns describe the exported
 * artefact in S3 when one was produced; `progress_pct` is the executor's own
 * progress stamp.
 *
 * Queue-depth guard (§3.2, :270-272): an organization SHOULD NOT hold more than
 * MAX_PENDING_JOBS outstanding `pending` jobs, enforced on the API path with a
 * Redis counter keyed by organization_id and released when a job reaches a
 * terminal state. That guard is **deliberately not a column** — it is a Redis
 * counter, and this table's contribution to it is `status` plus
 * IDX_REPORTS_REPORT_JOBS_STATUS, which is what the counter is reconciled
 * against. No column is added for it here because the plan specifies none.
 *
 * The organization FK is ON DELETE CASCADE per §3.2. `report_schema_id` is
 * nullable and carries the plan's literal default (NO ACTION): §3.2 states no
 * ON DELETE for it, and a nullable optional reference following the sibling
 * pattern in this codebase is NO ACTION (e.g. FINANCE_INVOICES.membership_id).
 * The same applies to `created_by`.
 *
 * IDX_REPORTS_REPORT_JOBS_CREATED_AT is DESC per §3.2. TypeORM's @Index()
 * decorator cannot express a sort direction, so the entity cannot declare this
 * index and the migration owns it — a future `migration:generate` will see it as
 * extra and want to drop it. See the entity's docblock.
 */
export class CreateReportJobsTable1788965263401 implements MigrationInterface {
    name = 'CreateReportJobsTable1788965263401'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "REPORTS_REPORT_JOBS" (
                "id"               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"  uuid NOT NULL,
                "report_schema_id" uuid,
                "status"           varchar(20) NOT NULL DEFAULT 'pending',
                "parameters"       jsonb,
                "result_s3_key"    varchar(500),
                "result_s3_bucket" varchar(200),
                "result_rows"      integer,
                "result_format"    varchar(10) DEFAULT 'json',
                "error_message"    text,
                "progress_pct"     integer DEFAULT 0,
                "started_at"       timestamptz,
                "completed_at"     timestamptz,
                "created_by"       uuid,
                "created_at"       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_REPORTS_REPORT_JOBS_ORG"
            ON "REPORTS_REPORT_JOBS" ("organization_id");
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_REPORTS_REPORT_JOBS_STATUS"
            ON "REPORTS_REPORT_JOBS" ("status");
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_REPORTS_REPORT_JOBS_SCHEMA_ID"
            ON "REPORTS_REPORT_JOBS" ("report_schema_id");
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_REPORTS_REPORT_JOBS_CREATED_AT"
            ON "REPORTS_REPORT_JOBS" ("created_at" DESC);
        `);

        // Named FK constraints, as in the sibling tables: the plan's §3.2 lists
        // them inline, but every FK in src/migrations/ is separately named.
        await queryRunner.query(`
            ALTER TABLE "REPORTS_REPORT_JOBS"
            ADD CONSTRAINT "FK_reports_report_jobs_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "REPORTS_REPORT_JOBS"
            ADD CONSTRAINT "FK_reports_report_jobs_report_schema"
            FOREIGN KEY ("report_schema_id")
            REFERENCES "REPORTS_REPORT_SCHEMAS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "REPORTS_REPORT_JOBS"
            ADD CONSTRAINT "FK_reports_report_jobs_created_by"
            FOREIGN KEY ("created_by")
            REFERENCES "IDENTITY_USERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "REPORTS_REPORT_JOBS" DROP CONSTRAINT IF EXISTS "FK_reports_report_jobs_created_by"`,
        );
        await queryRunner.query(
            `ALTER TABLE "REPORTS_REPORT_JOBS" DROP CONSTRAINT IF EXISTS "FK_reports_report_jobs_report_schema"`,
        );
        await queryRunner.query(
            `ALTER TABLE "REPORTS_REPORT_JOBS" DROP CONSTRAINT IF EXISTS "FK_reports_report_jobs_organization"`,
        );
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_REPORTS_REPORT_JOBS_CREATED_AT"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_REPORTS_REPORT_JOBS_SCHEMA_ID"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_REPORTS_REPORT_JOBS_STATUS"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_REPORTS_REPORT_JOBS_ORG"`);
        await queryRunner.query(`DROP TABLE "REPORTS_REPORT_JOBS"`);
    }
}