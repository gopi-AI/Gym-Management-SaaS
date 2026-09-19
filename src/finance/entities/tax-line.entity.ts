import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * P3-04 — tax applied to one invoice line.
 *
 * Columns follow `docs/database-plan.md` (ERD `FINANCE_TAX_LINES`):
 *   id, invoice_item_id, tax_name, tax_rate, tax_amount
 *
 * `organization_id` is the approved addition (same as `InvoiceItem`): every tenant
 * table in this codebase carries it so rows can be filtered by the authorized
 * organization without joining through the invoice.
 *
 * This table is an **immutable audit record**, so it has no `updated_at` and no
 * code path updates a row: `tax_rate` is denormalised from `FINANCE_TAX_RATES` on
 * purpose, recording the rate *as applied at the time*. A live lookup into the
 * rates table would make a historical invoice's tax change when a rate changes,
 * which is exactly the property a tax authority checks for.
 *
 * A tax-exempt line still gets a row (`tax_rate` and `tax_amount` both `0.00`,
 * `tax_name` `Tax exempt`). §4 is explicit that "a zero-rated line is a real audit
 * row, not a missing one" — a missing row cannot be told apart from a line nobody
 * computed tax for.
 */
@Entity('FINANCE_TAX_LINES')
@Index(['invoice_item_id'])
@Index(['organization_id'])
export class TaxLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  invoice_item_id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  /** Name of the rate applied, or `Tax exempt` for an exempt line. */
  @Column({ type: 'varchar', length: 255 })
  tax_name!: string;

  /** Percentage applied (0.00 for an exempt line), snapshotted at issue time. */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  tax_rate!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  tax_amount!: string;
}
