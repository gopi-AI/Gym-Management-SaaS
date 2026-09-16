import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add points_expiry_days to TENANCY_ORGANIZATIONS.
 *
 * Default is 365 days, configurable per-organization.
 * Per docs/phase2-scoping-plan.md §12 Q18: "365-day default expiry,
 * configurable per-org via Organization.points_expiry_days."
 */
export class AddOrgPointsExpiryDays1788965263251 implements MigrationInterface {
    name = 'AddOrgPointsExpiryDays1788965263251'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "TENANCY_ORGANIZATIONS"
            ADD COLUMN "points_expiry_days" int NOT NULL DEFAULT 365;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "TENANCY_ORGANIZATIONS"
            DROP COLUMN "points_expiry_days";
        `);
    }
}