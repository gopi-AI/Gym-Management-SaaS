import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 3 / P3-04 — Tax schema.
 *
 * Creates:
 *   FINANCE_TAX_RATES   configurable, per-organization tax rates
 *   FINANCE_TAX_LINES   tax applied to each invoice line (immutable audit record)
 *
 * `FINANCE_TAX_RATES` is net-new: the ERD (`docs/database-plan.md`) does not define
 * it, and the Phase 1 finance migration deliberately created only invoices, invoice
 * items, payments and the invoice-number counter (see that migration's note on the
 * "rest of the ERD's finance block"). `FINANCE_TAX_LINES` IS in the ERD but was
 * never created, despite `docs/task-backlog.md` claiming it was "completed in P1-04".
 *
 * Deviations from the ERD block, each matching the entity metadata in
 * `src/finance/entities/`:
 *   - `FINANCE_TAX_LINES.organization_id`: every tenant table in this codebase
 *     carries it, so tax rows can be filtered by the authorized organization
 *     without joining through the invoice.
 *   - `FINANCE_TAX_RATES` as a whole: the ERD has no rates table. It is required
 *     because `FINANCE_TAX_LINES` records tax as APPLIED (a snapshot) while this
 *     table holds rates as CONFIGURED — §4 of `docs/phase3-scoping-plan.md`.
 *   - `FINANCE_TAX_RATES.rate` is NUMERIC(5,2), not NUMERIC(15,2): it is a
 *     percentage, not money. `PT_PACKAGES.commission_percent` already uses
 *     NUMERIC(5,2) for the same reason. `FINANCE_TAX_LINES.tax_rate` matches.
 *   - No `branch_id` on `FINANCE_TAX_RATES`: rates are per organization (§15 Q6).
 *   - No `created_at`/`updated_at` on `FINANCE_TAX_LINES`: the table is append-only
 *     and nothing updates a row, so the columns would be unused.
 *
 * No data is written. No existing table is altered. `down()` drops only what this
 * migration created.
 */
export class CreateFinanceTaxTables1788965263255 implements MigrationInterface {
    name = 'CreateFinanceTaxTables1788965263255'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // FINANCE_TAX_RATES — configurable rates, one regime per organization.
        await queryRunner.query(`
            CREATE TABLE "FINANCE_TAX_RATES" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "name" character varying(255) NOT NULL,
                "code" character varying(50) NOT NULL,
                "rate" numeric(5,2) NOT NULL,
                "is_inclusive" boolean NOT NULL DEFAULT false,
                "is_active" boolean NOT NULL DEFAULT true,
                "effective_from" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "effective_to" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_finance_tax_rates" PRIMARY KEY ("id")
            )
        `);
        // `code` is what `InvoiceItem.tax_code` references, so it must resolve to
        // exactly one rate within an organization.
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_finance_tax_rates_org_code"
            ON "FINANCE_TAX_RATES" ("organization_id", "code")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_tax_rates_organization_id"
            ON "FINANCE_TAX_RATES" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_tax_rates_org_active"
            ON "FINANCE_TAX_RATES" ("organization_id", "is_active")
        `);
        // A rate cannot be negative, and an inclusive rate at or above 100% is
        // nonsensical (gross * r / (100 + r) would approach or exceed the gross).
        // Enforced in the database as well as in the DTO, because a compliance
        // figure should not depend on every future caller validating first.
        await queryRunner.query(`
            ALTER TABLE "FINANCE_TAX_RATES"
            ADD CONSTRAINT "CHK_finance_tax_rates_rate_range"
            CHECK ("rate" >= 0 AND ("is_inclusive" = false OR "rate" < 100))
        `);

        // FINANCE_TAX_LINES — tax applied per line; append-only.
        await queryRunner.query(`
            CREATE TABLE "FINANCE_TAX_LINES" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "invoice_item_id" uuid NOT NULL,
                "organization_id" uuid NOT NULL,
                "tax_name" character varying(255) NOT NULL,
                "tax_rate" numeric(5,2) NOT NULL,
                "tax_amount" numeric(15,2) NOT NULL,
                CONSTRAINT "PK_finance_tax_lines" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_tax_lines_invoice_item_id"
            ON "FINANCE_TAX_LINES" ("invoice_item_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_finance_tax_lines_organization_id"
            ON "FINANCE_TAX_LINES" ("organization_id")
        `);

        // Foreign keys (referential integrity is enforced in the database, as in
        // the Phase 1 finance schema migration).
        await queryRunner.query(`
            ALTER TABLE "FINANCE_TAX_RATES"
            ADD CONSTRAINT "FK_finance_tax_rates_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "FINANCE_TAX_LINES"
            ADD CONSTRAINT "FK_finance_tax_lines_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        // CASCADE: a tax line has no meaning without its invoice item, and the
        // invoice -> items edge is already CASCADE, so deleting an invoice must not
        // be blocked by an orphaned tax line.
        await queryRunner.query(`
            ALTER TABLE "FINANCE_TAX_LINES"
            ADD CONSTRAINT "FK_finance_tax_lines_invoice_item"
            FOREIGN KEY ("invoice_item_id")
            REFERENCES "FINANCE_INVOICE_ITEMS"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "FINANCE_TAX_LINES"`);
        await queryRunner.query(`DROP TABLE "FINANCE_TAX_RATES"`);
    }
}
