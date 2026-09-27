import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — seed §6.3's "Avg Session Duration" system report for every
 * **existing** organization (P6-38).
 *
 * This is the follow-on migration P6-07's entry anticipated: `Avg Session
 * Duration` was deliberately excluded from the initial 11-row seed
 * (`1788965263405-SeedSystemReportSchemas.ts`) because its `QueryDefinition` was
 * not executable — it declared `avg_duration`, which only exists as
 * `AVG(check_out_time - check_in_time)`, an aggregate over a difference of two
 * columns that §3.1.1's `columns` contract cannot express. P6-38 resolved that by
 * persisting the difference as `AttendanceRecord.duration_minutes`
 * (`1788965263409-AddAttendanceDurationMinutes.ts`), which reduces the measure to
 * `AVG(duration_minutes)` — an ordinary allowlisted aggregate over a real column.
 *
 * **Two paths, kept in lockstep.** This migration backfills organizations that
 * already exist; `src/reports/constants/system-report-catalog.ts` carries the
 * identical definition for organizations created afterwards (P6-44's provisioner).
 * Neither reads the other, so the definition is duplicated — the same arrangement
 * `1788965263407`/`1788965263408` use, and `1788965263405:15-18` records the
 * obligation to keep the copies checked against each other.
 *
 * The `query_definition` mirrors the plan's row: source `AttendanceRecord`, the
 * row's declared `member_id` dimension as the grouping key, the unexpressible
 * `avg_duration` now genuinely resolved to `AVG(duration_minutes)`, and the row's
 * declared `date_range` filter (the plan gives this row no branch filter, unlike
 * its §6.3 siblings, so none is added here).
 *
 * Idempotency is an application-level existence check because
 * `REPORTS_REPORT_SCHEMAS` has no uniqueness constraint on
 * organization/name/system — the same reason `1788965263405` gives. Re-running is
 * a no-op, and a custom same-name row is never touched.
 */
export const SYSTEM_REPORT_SCHEMA = {
    name: 'Avg Session Duration',
    description:
        'Average attendance session duration per member, resolved at write time onto AttendanceRecord.duration_minutes',
    category: 'attendance',
    query_definition: {
        source: 'AttendanceRecord',
        columns: {
            member_id: 'member_id',
            avg_duration: { fn: 'AVG', column: 'duration_minutes' },
        },
        filters: [
            { column: 'check_in_time', operator: 'BETWEEN', value: ['$from', '$to'] },
        ],
        group_by: ['member_id'],
        order_by: [{ column: 'member_id', direction: 'ASC' }],
    },
} as const;

export class SeedAvgSessionDurationSystemReport1788965263410
    implements MigrationInterface
{
    name = 'SeedAvgSessionDurationSystemReport1788965263410'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const organizations: Array<{ id: string }> = await queryRunner.query(
            `SELECT "id" FROM "TENANCY_ORGANIZATIONS" ORDER BY "id" ASC`,
        );

        for (const organization of organizations) {
            const existing: Array<{ id: string }> = await queryRunner.query(
                `SELECT "id" FROM "REPORTS_REPORT_SCHEMAS"
                 WHERE "organization_id" = $1
                   AND "name" = $2
                   AND "is_system" = true
                 ORDER BY "created_at" ASC, "id" ASC
                 LIMIT 1`,
                [organization.id, SYSTEM_REPORT_SCHEMA.name],
            );
            if (existing.length > 0) {
                continue;
            }

            await queryRunner.query(
                `INSERT INTO "REPORTS_REPORT_SCHEMAS"
                 ("organization_id", "name", "description", "category", "query_definition", "parameters", "is_system", "is_active", "created_by")
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, true, true, NULL)`,
                [
                    organization.id,
                    SYSTEM_REPORT_SCHEMA.name,
                    SYSTEM_REPORT_SCHEMA.description,
                    SYSTEM_REPORT_SCHEMA.category,
                    JSON.stringify(SYSTEM_REPORT_SCHEMA.query_definition),
                    JSON.stringify([]),
                ],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM "REPORTS_REPORT_SCHEMAS"
             WHERE "is_system" = true
               AND "name" = $1`,
            [SYSTEM_REPORT_SCHEMA.name],
        );
    }
}
