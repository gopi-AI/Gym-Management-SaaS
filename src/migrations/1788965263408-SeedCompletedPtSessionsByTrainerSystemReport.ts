import { MigrationInterface, QueryRunner } from 'typeorm';

export const SYSTEM_REPORT_SCHEMA = {
    name: 'Completed PT Sessions by Trainer',
    description: 'Count of completed PT sessions by trainer, grouped by scheduled month',
    category: 'pt',
    query_definition: {
        source: 'PTSession',
        columns: {
            month: { bucket: 'scheduled_start', unit: 'month' },
            trainer_id: 'trainer_id',
            session_count: { fn: 'COUNT', column: '*' },
        },
        filters: [
            { column: 'scheduled_start', operator: 'BETWEEN', value: ['$from', '$to'] },
            { column: 'status', operator: '=', value: 'completed' },
            { column: 'branch_id', operator: '=', value: '$branchId' },
        ],
        group_by: ['month', 'trainer_id'],
        order_by: [
            { column: 'month', direction: 'ASC' },
            { column: 'trainer_id', direction: 'ASC' },
        ],
    },
} as const;

export class SeedCompletedPtSessionsByTrainerSystemReport1788965263408
    implements MigrationInterface
{
    name = 'SeedCompletedPtSessionsByTrainerSystemReport1788965263408'

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