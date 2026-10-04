import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — REPORTS_REPORT_SCHEMAS.
 *
 * The report-definition catalog: one row per report schema (system or custom),
 * scoped to an organization.
 *
 * Implements docs/phase6-scoping-plan.md §3.1 (DDL, :173-190) and stores the
 * structure defined in §3.1.1: `query_definition` is structured JSON, NOT raw
 * SQL, so the executor can validate columns against entity metadata and apply
 * tenant scoping instead of executing user-supplied SQL. `parameters` holds the
 * declared parameter list for the schema.
 *
 * `category` values per §3.1: 'member' | 'finance' | 'attendance' | 'workout' |
 * 'diet' | 'pt' | 'loyalty' | 'ai-usage' | 'custom'. The plan states these as a
 * comment, not a CHECK constraint, so no constraint is added here.
 *
 * The organization FK is ON DELETE CASCADE exactly as §3.1 specifies. Note that
 * the finance and AI domains use ON DELETE NO ACTION for their organization FKs;
 * this follows the plan's explicit choice rather than the sibling pattern, and
 * the divergence is recorded in the entity's docblock.
 */
export class CreateReportSchemasTable1788965263400 implements MigrationInterface {
    name = 'CreateReportSchemasTable1788965263400'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "REPORTS_REPORT_SCHEMAS" (
                "id"               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id"  uuid NOT NULL,
                "name"             varchar(200) NOT NULL,
                "description"      text,
                "category"         varchar(50) NOT NULL DEFAULT 'custom',
                "query_definition" jsonb NOT NULL DEFAULT '{}',
                "parameters"       jsonb NOT NULL DEFAULT '[]',
                "is_system"        boolean NOT NULL DEFAULT false,
                "is_active"        boolean NOT NULL DEFAULT true,
                "created_by"       uuid,
                "created_at"       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at"       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_REPORTS_REPORT_SCHEMAS_ORG"
            ON "REPORTS_REPORT_SCHEMAS" ("organization_id");
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_REPORTS_REPORT_SCHEMAS_CATEGORY"
            ON "REPORTS_REPORT_SCHEMAS" ("category");
        `);

        // Named FK constraints, matching the sibling tables in this project
        // (FINANCE_INVOICES, AI_USAGE, MEMBERS_MEMBERSHIPS): the plan's §3.1 lists
        // them inline, but every FK in src/migrations/ is separately named so that
        // down() can drop it deterministically.
        await queryRunner.query(`
            ALTER TABLE "REPORTS_REPORT_SCHEMAS"
            ADD CONSTRAINT "FK_reports_report_schemas_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "REPORTS_REPORT_SCHEMAS"
            ADD CONSTRAINT "FK_reports_report_schemas_created_by"
            FOREIGN KEY ("created_by")
            REFERENCES "IDENTITY_USERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "REPORTS_REPORT_SCHEMAS" DROP CONSTRAINT IF EXISTS "FK_reports_report_schemas_created_by"`,
        );
        await queryRunner.query(
            `ALTER TABLE "REPORTS_REPORT_SCHEMAS" DROP CONSTRAINT IF EXISTS "FK_reports_report_schemas_organization"`,
        );
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_REPORTS_REPORT_SCHEMAS_CATEGORY"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_REPORTS_REPORT_SCHEMAS_ORG"`);
        await queryRunner.query(`DROP TABLE "REPORTS_REPORT_SCHEMAS"`);
    }
}