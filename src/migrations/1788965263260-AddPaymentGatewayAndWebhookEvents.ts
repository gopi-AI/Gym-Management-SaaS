import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentGatewayAndWebhookEvents1788965263260 implements MigrationInterface {
  name = 'AddPaymentGatewayAndWebhookEvents1788965263260';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENTS" ADD "gateway_reference" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENTS" ADD "gateway_status" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENTS" ADD "gateway_response" text`);
    await queryRunner.query(`ALTER TABLE "FINANCE_REFUNDS" ADD "idempotency_key" character varying(255)`);
    await queryRunner.query(`UPDATE "FINANCE_REFUNDS" SET "idempotency_key" = 'legacy-' || "id" WHERE "idempotency_key" IS NULL`);
    await queryRunner.query(`ALTER TABLE "FINANCE_REFUNDS" ALTER COLUMN "idempotency_key" SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_refunds_org_idempotency" ON "FINANCE_REFUNDS" ("organization_id", "idempotency_key")`);
    await queryRunner.query(`CREATE TABLE "FINANCE_WEBHOOK_EVENTS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying(100) NOT NULL, "provider_event_id" character varying(255) NOT NULL, "event_type" character varying(150) NOT NULL, "payload" jsonb NOT NULL, "organization_id" uuid, "status" character varying(20) NOT NULL DEFAULT 'received', "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_finance_webhook_events" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_webhook_events_provider_event" ON "FINANCE_WEBHOOK_EVENTS" ("provider_event_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_webhook_events_status_created" ON "FINANCE_WEBHOOK_EVENTS" ("status", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "FINANCE_WEBHOOK_EVENTS"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_refunds_org_idempotency"`);
    await queryRunner.query(`ALTER TABLE "FINANCE_REFUNDS" DROP COLUMN "idempotency_key"`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENTS" DROP COLUMN "gateway_response"`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENTS" DROP COLUMN "gateway_status"`);
    await queryRunner.query(`ALTER TABLE "FINANCE_PAYMENTS" DROP COLUMN "gateway_reference"`);
  }
}