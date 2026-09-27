import { MigrationInterface, QueryRunner } from 'typeorm';

/** P3-08 dunning event dispatch audit. Payment retry counters remain on Payment. */
export class CreateFinanceDunningAttempts1788965263269 implements MigrationInterface {
  name = 'CreateFinanceDunningAttempts1788965263269';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "FINANCE_DUNNING_ATTEMPTS" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "organization_id" uuid NOT NULL,
      "invoice_id" uuid NOT NULL,
      "channel" character varying(50) NOT NULL,
      "attempt_number" integer NOT NULL,
      "event_type" character varying(50) NOT NULL,
      "scheduled_at" timestamptz NOT NULL,
      "sent_at" timestamptz,
      "outcome" character varying(50) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_finance_dunning_attempts" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_dunning_org_invoice_attempt" ON "FINANCE_DUNNING_ATTEMPTS" ("organization_id", "invoice_id", "attempt_number")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_dunning_org_invoice_event" ON "FINANCE_DUNNING_ATTEMPTS" ("organization_id", "invoice_id", "event_type")`);
    await queryRunner.query(`ALTER TABLE "FINANCE_DUNNING_ATTEMPTS" ADD CONSTRAINT "FK_finance_dunning_organization" FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")`);
    await queryRunner.query(`ALTER TABLE "FINANCE_DUNNING_ATTEMPTS" ADD CONSTRAINT "FK_finance_dunning_invoice" FOREIGN KEY ("invoice_id") REFERENCES "FINANCE_INVOICES"("id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FINANCE_DUNNING_ATTEMPTS" DROP CONSTRAINT "FK_finance_dunning_invoice"`);
    await queryRunner.query(`ALTER TABLE "FINANCE_DUNNING_ATTEMPTS" DROP CONSTRAINT "FK_finance_dunning_organization"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_dunning_org_invoice_event"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_dunning_org_invoice_attempt"`);
    await queryRunner.query(`DROP TABLE "FINANCE_DUNNING_ATTEMPTS"`);
  }
}