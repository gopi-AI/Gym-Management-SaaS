import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMeasurementLogTable1788965263237 implements MigrationInterface {
    name = 'CreateMeasurementLogTable1788965263237'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "MEMBERS_MEMBER_MEASUREMENTS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "member_id" uuid NOT NULL,
                "measurement_type" character varying(50) NOT NULL,
                "value" numeric(8,2) NOT NULL,
                "unit" character varying(10) NOT NULL,
                "measured_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "measured_by" uuid,
                "notes" text,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_member_measurements" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_measurements_org_member_type_date"
            ON "MEMBERS_MEMBER_MEASUREMENTS" ("organization_id", "member_id", "measurement_type", "measured_at")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_measurements_member_id"
            ON "MEMBERS_MEMBER_MEASUREMENTS" ("member_id")
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERS_MEMBER_MEASUREMENTS"
            ADD CONSTRAINT "FK_measurements_member_id"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE CASCADE
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_MEASUREMENTS" DROP CONSTRAINT "FK_measurements_member_id"`);
        await queryRunner.query(`DROP INDEX "IDX_measurements_org_member_type_date"`);
        await queryRunner.query(`DROP INDEX "IDX_measurements_member_id"`);
        await queryRunner.query(`DROP TABLE "MEMBERS_MEMBER_MEASUREMENTS"`);
    }
}