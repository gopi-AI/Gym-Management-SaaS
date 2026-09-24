import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 3 / P3-04 — Member tax exemption.
 *
 * Adds:
 *   MEMBERS_MEMBERS.tax_exempt         boolean, default false
 *   MEMBERS_MEMBERS.tax_exempt_reason  varchar(255), nullable
 *
 * **Placement is a ruled decision** (§15 Q7): exemption attaches to the MEMBER,
 * not to the organization and not to the invoice line. The backlog's requirement
 * ("Tax-exempt members handled") points at the member, and a member-level flag is
 * the only one of the three that models a genuinely exempt payer (a non-profit or
 * government member) rather than a zero-rated product category.
 *
 * `tax_exempt_reason` exists because an exemption with no recorded basis is
 * unauditable: a tax authority asking "why was this invoice not taxed?" must get
 * an answer from the data, not from an operator's memory. It is nullable because a
 * member who is simply not exempt has nothing to record, and NOT NULL is not
 * enforced on it when `tax_exempt` is true either — the DTO requires the reason at
 * the API boundary, and back-filling a placeholder reason for a column added to
 * existing rows would put invented text in an audit field.
 *
 * `NOT NULL DEFAULT false` backfills every existing member as non-exempt, which is
 * the correct reading of history: no member was exempt before this column existed,
 * and every Phase 1 invoice already carries `tax_amount = 0.00` for the unrelated
 * reason that no tax engine existed.
 *
 * `down()` drops both columns. It is lossy (the exemption data is discarded), which
 * is unavoidable for a column removal and is why this is a separate migration from
 * the tax tables: reverting the tax schema does not have to touch member data.
 */
export class AddMemberTaxExemption1788965263256 implements MigrationInterface {
    name = 'AddMemberTaxExemption1788965263256'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "MEMBERS_MEMBERS"
            ADD COLUMN "tax_exempt" boolean NOT NULL DEFAULT false,
            ADD COLUMN "tax_exempt_reason" character varying(255)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "MEMBERS_MEMBERS"
            DROP COLUMN "tax_exempt_reason",
            DROP COLUMN "tax_exempt"
        `);
    }
}
