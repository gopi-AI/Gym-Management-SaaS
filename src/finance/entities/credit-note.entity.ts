import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * P3-02 — a credit note reducing an invoice (`FINANCE_CREDIT_NOTES`).
 *
 * Columns follow `docs/database-plan.md` (ERD `FINANCE_CREDIT_NOTES`):
 *   id, invoice_id, reason, amount, issued_date, status, created_at
 *
 * `organization_id` is the approved addition (same as `InvoiceItem`), so
 * `GET /v1/credit-notes` can list for the authorized organization directly.
 *
 * **A credit note attaches to an INVOICE, not a payment** (§2's table): the
 * invoice is reduced without money moving. It therefore has no gateway
 * involvement and no `pending` state — see `CREDIT_NOTE_STATUS`.
 *
 * ## The tax breakdown, and why it lives here (§15 Q5 tax-reversal ruling)
 *
 * `net_amount` / `tax_amount` / `gross_amount` are computed **at creation time**
 * and stored on the credit note itself. `FINANCE_TAX_LINES` is NOT written to,
 * and NOT changed: that table is an immutable audit record of the tax applied to
 * each invoice line, and a credit note is a *separate adjustment record* under
 * Model A. Recording a reversal there would mean either mutating an audit row or
 * giving it a second, opposite meaning depending on which row it pointed at.
 *
 * Because `gross_amount = net_amount + tax_amount` exactly (the same one-place
 * rounding rule as `computeLineTax`), the reversal is arithmetically the exact
 * inverse of what was originally charged, and it reconciles without touching the
 * original rows: `Invoice.tax_amount - SUM(credit_notes.tax_amount)` is the tax
 * actually retained.
 *
 * `gross_amount` is the figure that reduces the invoice's **derived** outstanding
 * balance — under Model A `Invoice.status` is never rewritten, so the balance is
 * the only place the credit is visible on the invoice itself.
 *
 * No `updated_at`: like `FINANCE_TAX_LINES`, this is an append-only financial
 * record. A mistaken credit note is `voided`, never edited or deleted.
 */
@Entity('FINANCE_CREDIT_NOTES')
@Index(['organization_id', 'status'])
@Index(['invoice_id'])
@Index(['organization_id', 'issued_date'])
export class CreditNote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning organization, from the authorized tenant context. */
  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  /** The invoice being reduced. */
  @Column({ type: 'uuid' })
  @Index()
  invoice_id!: string;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  /** Portion of the credit that reverses the invoice's net (pre-tax) amount. */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  net_amount!: string;

  /** Portion that reverses tax originally recorded in `FINANCE_TAX_LINES`. */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  tax_amount!: string;

  /**
   * `net_amount + tax_amount` — the amount the invoice's outstanding balance is
   * reduced by. Stored rather than derived so the figure a report reads is the
   * figure that was applied at the time, even if the arithmetic helper changes.
   */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  gross_amount!: string;

  @Column({ type: 'timestamptz' })
  issued_date!: Date;

  /** issued | voided (see CREDIT_NOTE_STATUS). */
  @Column({ type: 'varchar', length: 50, default: 'issued' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
