import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — FINANCE_REFUNDS.
 *
 * The refund table whose absence P6-21 resolved. Implements P6-21's resolution
 * (A) as recorded in docs/phase6-scoping-plan.md §6.2 (:469-475): §6.2's
 * "Refund Report" row declares `Source = Refund` with Key Columns
 * `refund_date, amount, reason`, so the entity must carry all three under those
 * names plus `organization_id`, which the executor's tenant scoping filters on.
 *
 * Column set — the minimum the catalog row requires, not a refund lifecycle:
 *   organization_id, refund_date, amount, reason (+ id and the audit stamps
 *   `created_at` / `updated_at` that FINANCE_INVOICES also carries).
 *
 * Deliberately NOT included, because §6.2 (:471) assigns them to P3-02 rather
 * than to this row: a link to the refunded invoice or payment, a refund
 * lifecycle status, and a currency. Adding any of them here would be inventing a
 * design the plan left open. `refund_date` has no DEFAULT for the same reason:
 * §6.2 treats it as the refund's event time, written by the caller.
 *
 * FK behavior follows the finance domain's sibling tables rather than §3.1's
 * report tables: FINANCE_INVOICES and FINANCE_PAYMENTS declare
 * ON DELETE NO ACTION for their organization FK, so this table does too.
 *
 * Ordering: this migration must precede any migration that seeds a `Refund`
 * source into the report catalog (§6.2 :473 — the seed must run after the source
 * entity exists, or the seeded row passes creation and then fails on every
 * execution). Its timestamp is above every existing migration's, so a later seed
 * migration sorts after it by construction.
 */
export class CreateFinanceRefundsTable1788965263256 implements MigrationInterface {
    name = 'CreateFinanceRefundsTable1788965263256'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "FINANCE_REFUNDS" (
                "id"              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                "organization_id" uuid NOT NULL,
                "refund_date"     timestamptz NOT NULL,
                "amount"          numeric(15,2) NOT NULL,
                "reason"          text,
                "created_at"      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at"      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_FINANCE_REFUNDS_ORG"
            ON "FINANCE_REFUNDS" ("organization_id");
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_FINANCE_REFUNDS_ORG_DATE"
            ON "FINANCE_REFUNDS" ("organization_id", "refund_date");
        `);

        await queryRunner.query(`
            ALTER TABLE "FINANCE_REFUNDS"
            ADD CONSTRAINT "FK_finance_refunds_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "FINANCE_REFUNDS" DROP CONSTRAINT IF EXISTS "FK_finance_refunds_organization"`,
        );
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_FINANCE_REFUNDS_ORG_DATE"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_FINANCE_REFUNDS_ORG"`);
        await queryRunner.query(`DROP TABLE "FINANCE_REFUNDS"`);
    }
}