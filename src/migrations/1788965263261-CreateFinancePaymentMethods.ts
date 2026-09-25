import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinancePaymentMethods1788965263261 implements MigrationInterface {
  name = 'CreateFinancePaymentMethods1788965263261';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "FINANCE_PAYMENT_METHODS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "member_id" uuid NOT NULL, "stripe_customer_id" character varying(255) NOT NULL, "stripe_payment_method_id" character varying(255) NOT NULL, "is_default" boolean NOT NULL DEFAULT false, "card_brand" character varying(50), "card_last4" character varying(4), CONSTRAINT "PK_finance_payment_methods" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_payment_methods_org_member_provider" ON "FINANCE_PAYMENT_METHODS" ("organization_id", "member_id", "stripe_payment_method_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_payment_methods_org_member_default" ON "FINANCE_PAYMENT_METHODS" ("organization_id", "member_id", "is_default")`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENT_METHODS" ADD CONSTRAINT "FK_finance_payment_methods_organization" FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENT_METHODS" ADD CONSTRAINT "FK_finance_payment_methods_member" FOREIGN KEY ("member_id") REFERENCES "MEMBERS_MEMBERS"("id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENT_METHODS" DROP CONSTRAINT "FK_finance_payment_methods_member"`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENT_METHODS" DROP CONSTRAINT "FK_finance_payment_methods_organization"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_payment_methods_org_member_default"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_payment_methods_org_member_provider"`);
    await queryRunner.query(`DROP TABLE "FINANCE_PAYMENT_METHODS"`);
  }
}