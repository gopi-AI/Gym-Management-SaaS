import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMembershipDiscounts1788965263262 implements MigrationInterface {
  name = 'CreateMembershipDiscounts1788965263262';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "MEMBERSHIP_MEMBERSHIP_DISCOUNTS" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "membership_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "discount_type" character varying(20) NOT NULL,
        "amount" numeric(15,2) NOT NULL,
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "ends_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_membership_discounts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_membership_discounts_type" CHECK ("discount_type" IN ('fixed', 'percentage')),
        CONSTRAINT "CHK_membership_discounts_amount" CHECK ("amount" > 0 AND ("discount_type" <> 'percentage' OR "amount" <= 100)),
        CONSTRAINT "CHK_membership_discounts_dates" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_membership_discounts_membership_id" ON "MEMBERSHIP_MEMBERSHIP_DISCOUNTS" ("membership_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_membership_discounts_organization_id" ON "MEMBERSHIP_MEMBERSHIP_DISCOUNTS" ("organization_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_membership_discounts_one_active" ON "MEMBERSHIP_MEMBERSHIP_DISCOUNTS" ("membership_id") WHERE "ends_at" IS NULL`);
    await queryRunner.query(`ALTER TABLE "MEMBERSHIP_MEMBERSHIP_DISCOUNTS" ADD CONSTRAINT "FK_membership_discounts_membership" FOREIGN KEY ("membership_id") REFERENCES "MEMBERSHIPS_MEMBERSHIPS"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "MEMBERSHIP_MEMBERSHIP_DISCOUNTS" ADD CONSTRAINT "FK_membership_discounts_organization" FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "MEMBERSHIP_MEMBERSHIP_DISCOUNTS"`);
  }
}