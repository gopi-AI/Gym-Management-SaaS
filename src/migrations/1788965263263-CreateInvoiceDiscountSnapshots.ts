import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvoiceDiscountSnapshots1788965263263 implements MigrationInterface {
  name = 'CreateInvoiceDiscountSnapshots1788965263263';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "FINANCE_INVOICE_DISCOUNTS" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "membership_discount_id" uuid NOT NULL,
        "discount_type" character varying(20) NOT NULL,
        "amount" numeric(15,2) NOT NULL,
        "applied_amount" numeric(15,2) NOT NULL,
        CONSTRAINT "PK_finance_invoice_discounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_finance_invoice_discounts_invoice_id" ON "FINANCE_INVOICE_DISCOUNTS" ("invoice_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_invoice_discounts_organization_id" ON "FINANCE_INVOICE_DISCOUNTS" ("organization_id")`);
    await queryRunner.query(`ALTER TABLE "FINANCE_INVOICE_DISCOUNTS" ADD CONSTRAINT "FK_finance_invoice_discounts_invoice" FOREIGN KEY ("invoice_id") REFERENCES "FINANCE_INVOICES"("id") ON DELETE CASCADE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "FINANCE_INVOICE_DISCOUNTS"`);
  }
}