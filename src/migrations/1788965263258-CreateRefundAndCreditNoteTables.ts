import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 3 / P3-02 — Refunds and credit notes.
 *
 * Creates:
 *   FINANCE_REFUNDS        money returned to a member, attached to a payment
 *   FINANCE_CREDIT_NOTES   an invoice reduced without money moving
 *
 * Both tables are in the ERD (`docs/database-plan.md`) but were never created:
 * the Phase 1 finance migration deliberately created only invoices, invoice
 * items, payments and the invoice-number counter (see that migration's note on
 * the "rest of the ERD's finance block"). `docs/task-backlog.md` previously and
 * falsely claimed both were "completed in P1-04"; that annotation was corrected.
 *
 * Deviations from the ERD block, each matching the entity metadata in
 * `src/finance/entities/`:
 *   - `organization_id` on both tables: every tenant table in this codebase
 *     carries it, so rows can be filtered by the authorized organization without
 *     joining through the payment or the invoice.
 *   - `FINANCE_CREDIT_NOTES` carries net/tax/gross rather than the ERD's single
 *     `amount`: a credit note must reverse the tax applied to its invoice, and it
 *     does so by recording its OWN breakdown rather than by touching
 *     `FINANCE_TAX_LINES`, which is an immutable audit record (§15 Q5
 *     tax-reversal ruling).
 *   - No `updated_at` on either table: both are append-only financial records. A
 *     mistake is corrected by a compensating record (a `voided` credit note),
 *     never by an edit, so a modification stamp would be unused.
 *
 * `FINANCE_PAYMENT_ALLOCATIONS` is deliberately NOT created: §15 Q4 rules
 * line-level allocation out of scope entirely.
 *
 * No data is written. No existing table is altered. `down()` drops only what this
 * migration created.
 */
export class CreateRefundAndCreditNoteTables1788965263258 implements MigrationInterface {
    name = 'CreateRefundAndCreditNoteTables1788965263258'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // FINANCE_REFUNDS — a refund is always against a PAYMENT, which is what
        // makes `SUM(refunds.amount) <= payment.amount` checkable.
        await queryRunner.query(`
            CREATE TABLE "FINANCE_REFUNDS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "payment_id" uuid NOT NULL,
                "reason" character varying(500) NOT NULL,
                "amount" numeric(15,2) NOT NULL,
                "refund_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "status" character varying(50) NOT NULL DEFAULT 'pending',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_finance_refunds" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_refunds_organization_id"
            ON "FINANCE_REFUNDS" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_refunds_payment_id"
            ON "FINANCE_REFUNDS" ("payment_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_refunds_org_status"
            ON "FINANCE_REFUNDS" ("organization_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_refunds_org_date"
            ON "FINANCE_REFUNDS" ("organization_id", "refund_date")
        `);
        // A zero or negative refund is not a refund. Enforced in the database as
        // well as in the DTO, because a compliance figure should not depend on
        // every future caller validating first.
        await queryRunner.query(`
            ALTER TABLE "FINANCE_REFUNDS"
            ADD CONSTRAINT "CHK_finance_refunds_amount_positive"
            CHECK ("amount" > 0)
        `);

        // FINANCE_CREDIT_NOTES — attaches to an INVOICE; no money moves.
        await queryRunner.query(`
            CREATE TABLE "FINANCE_CREDIT_NOTES" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "invoice_id" uuid NOT NULL,
                "reason" character varying(500) NOT NULL,
                "net_amount" numeric(15,2) NOT NULL,
                "tax_amount" numeric(15,2) NOT NULL,
                "gross_amount" numeric(15,2) NOT NULL,
                "issued_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "status" character varying(50) NOT NULL DEFAULT 'issued',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_finance_credit_notes" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_credit_notes_organization_id"
            ON "FINANCE_CREDIT_NOTES" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_credit_notes_invoice_id"
            ON "FINANCE_CREDIT_NOTES" ("invoice_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_credit_notes_org_status"
            ON "FINANCE_CREDIT_NOTES" ("organization_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_credit_notes_org_date"
            ON "FINANCE_CREDIT_NOTES" ("organization_id", "issued_date")
        `);
        // The §15 Q5 ruling stores the breakdown on the credit note; this is that
        // ruling's arithmetic asserted by the database, so a credit note can never
        // be persisted whose parts do not add up to what it reverses.
        await queryRunner.query(`
            ALTER TABLE "FINANCE_CREDIT_NOTES"
            ADD CONSTRAINT "CHK_finance_credit_notes_amounts_balance"
            CHECK ("gross_amount" = "net_amount" + "tax_amount" AND "gross_amount" > 0)
        `);

        // Foreign keys (referential integrity is enforced in the database, as in
        // the Phase 1 finance schema migration).
        await queryRunner.query(`
            ALTER TABLE "FINANCE_REFUNDS"
            ADD CONSTRAINT "FK_finance_refunds_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_REFUNDS"
            ADD CONSTRAINT "FK_finance_refunds_payment"
            FOREIGN KEY ("payment_id")
            REFERENCES "FINANCE_PAYMENTS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_CREDIT_NOTES"
            ADD CONSTRAINT "FK_finance_credit_notes_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        // NO ACTION, not CASCADE: an invoice with a credit note against it must not
        // be deletable, or the credit would vanish and the member's balance would
        // silently reappear.
        await queryRunner.query(`
            ALTER TABLE "FINANCE_CREDIT_NOTES"
            ADD CONSTRAINT "FK_finance_credit_notes_invoice"
            FOREIGN KEY ("invoice_id")
            REFERENCES "FINANCE_INVOICES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "FINANCE_CREDIT_NOTES"`);
        await queryRunner.query(`DROP TABLE "FINANCE_REFUNDS"`);
    }
}
