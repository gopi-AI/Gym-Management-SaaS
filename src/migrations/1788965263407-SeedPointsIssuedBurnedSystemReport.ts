import { MigrationInterface, QueryRunner } from 'typeorm';

export const SYSTEM_REPORT_SCHEMA = {
    name: 'Points Issued/Burned',
    description: 'Loyalty points movements over time',
    category: 'loyalty',
    query_definition: {
        source: 'LoyaltyTransaction',
        columns: {
            period: { bucket: 'created_at', unit: 'month' },
            transaction_type: 'transaction_type',
            count: { fn: 'COUNT', column: '*' },
            total_points: { fn: 'SUM', column: 'points' },
        },
        filters: [{ column: 'created_at', operator: 'BETWEEN', value: ['$from', '$to'] }],
        group_by: ['period', 'transaction_type'],
        order_by: [
            { column: 'period', direction: 'ASC' },
            { column: 'transaction_type', direction: 'ASC' },
        ],
    },
} as const;

export class SeedPointsIssuedBurnedSystemReport1788965263407 implements MigrationInterface {
    name = 'SeedPointsIssuedBurnedSystemReport1788965263407'

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