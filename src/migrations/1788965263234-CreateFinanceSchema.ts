import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 1 — Finance schema (invoices + payments).
 *
 * Creates:
 *   FINANCE_INVOICES                invoice header
 *   FINANCE_INVOICE_ITEMS           billable lines
 *   FINANCE_PAYMENTS                payments (single source of truth for money in)
 *   FINANCE_INVOICE_NUMBER_COUNTERS per-organization invoice number sequence
 *
 * The rest of the ERD's finance block (refunds, credit notes, tax lines, ledger,
 * payment allocations) is intentionally NOT created: those flows are not
 * implemented (see the TODOs in `src/finance`), and empty tables no code path can
 * write are dead weight.
 *
 * Deviations from the ERD block, each matching the entity metadata in
 * `src/finance/entities/`:
 *   - `FINANCE_INVOICE_ITEMS.organization_id`: every tenant table in this
 *     codebase carries it, so items can be filtered by the authorized
 *     organization without joining through the invoice.
 *   - `FINANCE_PAYMENTS.member_id`: the database plan's own Indexing section
 *     requires `(member_id, payment_date)`, which is impossible without the
 *     column; it is denormalised from the invoice for "payments by member".
 *   - `FINANCE_PAYMENTS.retry_count` / `last_attempt_at` / `next_retry_at` /
 *     `last_failure_reason`: the payment retry worker's schedule must survive a
 *     process restart, so it is persisted on the row rather than held in memory.
 *   - No `amount_paid` column on the invoice: the amount paid is always derived
 *     from succeeded payments, so no denormalised balance can drift.
 */
export class CreateFinanceSchema1788965263234 implements MigrationInterface {
    name = 'CreateFinanceSchema1788965263234'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // FINANCE_INVOICES
        await queryRunner.query(`
            CREATE TABLE "FINANCE_INVOICES" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "branch_id" uuid,
                "member_id" uuid NOT NULL,
                "membership_id" uuid,
                "invoice_number" character varying(50) NOT NULL,
                "invoice_date" TIMESTAMP WITH TIME ZONE NOT NULL,
                "due_date" TIMESTAMP WITH TIME ZONE NOT NULL,
                "subtotal" numeric(15,2) NOT NULL,
                "tax_amount" numeric(15,2) NOT NULL DEFAULT 0,
                "total_amount" numeric(15,2) NOT NULL,
                "status" character varying(50) NOT NULL DEFAULT 'draft',
                "paid_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_finance_invoices" PRIMARY KEY ("id")
            )
        `);
        // Backstop for the per-organization sequence: even if the locked counter
        // were bypassed, two invoices can never share a number.
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_finance_invoices_org_number"
            ON "FINANCE_INVOICES" ("organization_id", "invoice_number")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_invoices_organization_id"
            ON "FINANCE_INVOICES" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_invoices_member_id"
            ON "FINANCE_INVOICES" ("member_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_invoices_membership_id"
            ON "FINANCE_INVOICES" ("membership_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_invoices_org_status"
            ON "FINANCE_INVOICES" ("organization_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_invoices_member_date"
            ON "FINANCE_INVOICES" ("member_id", "invoice_date")
        `);

        // FINANCE_INVOICE_ITEMS
        await queryRunner.query(`
            CREATE TABLE "FINANCE_INVOICE_ITEMS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "invoice_id" uuid NOT NULL,
                "organization_id" uuid NOT NULL,
                "description" character varying(500) NOT NULL,
                "quantity" numeric(15,2) NOT NULL DEFAULT 1,
                "unit_price" numeric(15,2) NOT NULL,
                "line_total" numeric(15,2) NOT NULL,
                "tax_code" character varying(50),
                CONSTRAINT "PK_finance_invoice_items" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_invoice_items_invoice_id"
            ON "FINANCE_INVOICE_ITEMS" ("invoice_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_invoice_items_organization_id"
            ON "FINANCE_INVOICE_ITEMS" ("organization_id")
        `);

        // FINANCE_PAYMENTS
        await queryRunner.query(`
            CREATE TABLE "FINANCE_PAYMENTS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "branch_id" uuid,
                "member_id" uuid NOT NULL,
                "invoice_id" uuid NOT NULL,
                "payment_method" character varying(50) NOT NULL,
                "transaction_id" character varying(255),
                "amount" numeric(15,2) NOT NULL,
                "payment_date" TIMESTAMP WITH TIME ZONE NOT NULL,
                "status" character varying(50) NOT NULL DEFAULT 'pending',
                "idempotency_key" character varying(255) NOT NULL,
                "retry_count" integer NOT NULL DEFAULT 0,
                "last_attempt_at" TIMESTAMP WITH TIME ZONE,
                "next_retry_at" TIMESTAMP WITH TIME ZONE,
                "last_failure_reason" character varying(500),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_finance_payments" PRIMARY KEY ("id")
            )
        `);
        // The documented duplicate-payment guard: one payment per idempotency key,
        // enforced by the database rather than by an application check.
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_finance_payments_idempotency_key"
            ON "FINANCE_PAYMENTS" ("idempotency_key")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_payments_organization_id"
            ON "FINANCE_PAYMENTS" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_payments_member_id"
            ON "FINANCE_PAYMENTS" ("member_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_payments_invoice_id"
            ON "FINANCE_PAYMENTS" ("invoice_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_payments_member_time"
            ON "FINANCE_PAYMENTS" ("member_id", "payment_date")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_payments_org_status"
            ON "FINANCE_PAYMENTS" ("organization_id", "status")
        `);
        // Access path of the payment retry worker.
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_payments_status_retry"
            ON "FINANCE_PAYMENTS" ("status", "next_retry_at")
        `);

        // FINANCE_INVOICE_NUMBER_COUNTERS
        await queryRunner.query(`
            CREATE TABLE "FINANCE_INVOICE_NUMBER_COUNTERS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "last_invoice_number" integer NOT NULL DEFAULT 0,
                CONSTRAINT "PK_finance_invoice_number_counters" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_finance_invoice_number_counters_org"
            ON "FINANCE_INVOICE_NUMBER_COUNTERS" ("organization_id")
        `);

        // Foreign keys (referential integrity is enforced in the database, as in
        // the memberships schema migration).
        await queryRunner.query(`
            ALTER TABLE "FINANCE_INVOICES"
            ADD CONSTRAINT "FK_finance_invoices_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_INVOICES"
            ADD CONSTRAINT "FK_finance_invoices_branch"
            FOREIGN KEY ("branch_id")
            REFERENCES "TENANCY_BRANCHES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_INVOICES"
            ADD CONSTRAINT "FK_finance_invoices_member"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_INVOICES"
            ADD CONSTRAINT "FK_finance_invoices_membership"
            FOREIGN KEY ("membership_id")
            REFERENCES "MEMBERSHIPS_MEMBERSHIPS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_INVOICE_ITEMS"
            ADD CONSTRAINT "FK_finance_invoice_items_invoice"
            FOREIGN KEY ("invoice_id")
            REFERENCES "FINANCE_INVOICES"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_PAYMENTS"
            ADD CONSTRAINT "FK_finance_payments_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_PAYMENTS"
            ADD CONSTRAINT "FK_finance_payments_branch"
            FOREIGN KEY ("branch_id")
            REFERENCES "TENANCY_BRANCHES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_PAYMENTS"
            ADD CONSTRAINT "FK_finance_payments_member"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_PAYMENTS"
            ADD CONSTRAINT "FK_finance_payments_invoice"
            FOREIGN KEY ("invoice_id")
            REFERENCES "FINANCE_INVOICES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_INVOICE_NUMBER_COUNTERS"
            ADD CONSTRAINT "FK_finance_invoice_number_counters_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "FINANCE_PAYMENTS"`);
        await queryRunner.query(`DROP TABLE "FINANCE_INVOICE_ITEMS"`);
        await queryRunner.query(`DROP TABLE "FINANCE_INVOICES"`);
        await queryRunner.query(`DROP TABLE "FINANCE_INVOICE_NUMBER_COUNTERS"`);
    }
}
