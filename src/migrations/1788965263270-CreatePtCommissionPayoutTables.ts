import { MigrationInterface, QueryRunner } from 'typeorm';

/** P3-12 bulk PT commission payout run and immutable item snapshots. */
export class CreatePtCommissionPayoutTables1788965263270 implements MigrationInterface {
  name = 'CreatePtCommissionPayoutTables1788965263270';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "PT_COMMISSION_PAYOUT_RUNS" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "organization_id" uuid NOT NULL,
      "period_start" date NOT NULL,
      "period_end" date NOT NULL,
      "status" varchar(30) NOT NULL DEFAULT 'pending',
      "total_amount" numeric(15,2) NOT NULL DEFAULT 0,
      "currency" varchar(3) NOT NULL,
      "created_by" uuid,
      "processed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_pt_commission_payout_runs" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_pt_payout_runs_org_created" ON "PT_COMMISSION_PAYOUT_RUNS" ("organization_id", "created_at")`);
    await queryRunner.query(`CREATE TABLE "PT_COMMISSION_PAYOUT_ITEMS" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "organization_id" uuid NOT NULL,
      "payout_run_id" uuid NOT NULL,
      "trainer_commission_id" uuid NOT NULL,
      "trainer_id" uuid NOT NULL,
      "amount" numeric(10,2) NOT NULL,
      "currency" varchar(3) NOT NULL,
      "status" varchar(20) NOT NULL DEFAULT 'pending',
      "paid_at" timestamptz,
      "paid_amount" numeric(10,2),
      CONSTRAINT "PK_pt_commission_payout_items" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pt_payout_items_org_commission" ON "PT_COMMISSION_PAYOUT_ITEMS" ("organization_id", "trainer_commission_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_pt_payout_items_org_run" ON "PT_COMMISSION_PAYOUT_ITEMS" ("organization_id", "payout_run_id")`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_RUNS" ADD CONSTRAINT "FK_pt_payout_runs_organization" FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_RUNS" ADD CONSTRAINT "FK_pt_payout_runs_created_by" FOREIGN KEY ("created_by") REFERENCES "IDENTITY_USERS"("id")`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_ITEMS" ADD CONSTRAINT "FK_pt_payout_items_organization" FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_ITEMS" ADD CONSTRAINT "FK_pt_payout_items_run" FOREIGN KEY ("payout_run_id") REFERENCES "PT_COMMISSION_PAYOUT_RUNS"("id")`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_ITEMS" ADD CONSTRAINT "FK_pt_payout_items_commission" FOREIGN KEY ("trainer_commission_id") REFERENCES "PT_TRAINER_COMMISSIONS"("id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_ITEMS" DROP CONSTRAINT "FK_pt_payout_items_commission"`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_ITEMS" DROP CONSTRAINT "FK_pt_payout_items_run"`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_ITEMS" DROP CONSTRAINT "FK_pt_payout_items_organization"`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_RUNS" DROP CONSTRAINT "FK_pt_payout_runs_created_by"`);
    await queryRunner.query(`ALTER TABLE "PT_COMMISSION_PAYOUT_RUNS" DROP CONSTRAINT "FK_pt_payout_runs_organization"`);
    await queryRunner.query(`DROP INDEX "IDX_pt_payout_items_org_run"`);
    await queryRunner.query(`DROP INDEX "UQ_pt_payout_items_org_commission"`);
    await queryRunner.query(`DROP TABLE "PT_COMMISSION_PAYOUT_ITEMS"`);
    await queryRunner.query(`DROP INDEX "IDX_pt_payout_runs_org_created"`);
    await queryRunner.query(`DROP TABLE "PT_COMMISSION_PAYOUT_RUNS"`);
  }
}