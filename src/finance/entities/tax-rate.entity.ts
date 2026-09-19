import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * P3-04 — configurable tax rate.
 *
 * **Net-new table**: `FINANCE_TAX_RATES` is not in the ERD (`docs/database-plan.md`).
 * The backlog said only "Potentially tax_rates table"; §4 of
 * `docs/phase3-scoping-plan.md` confirms both tables are needed, because
 * `FINANCE_TAX_LINES` records tax *as applied* while this table holds rates
 * *as configured*.
 *
 * **Granularity: per organization** (§15 Q6 ruling). There is deliberately no
 * `branch_id` and no item-category scoping: one tax regime per tenant. Adding
 * either later is an additive change (a nullable column plus a narrower lookup),
 * whereas removing one after invoices have been written under it would not be.
 *
 * `rate` is a PERCENTAGE (`18.00` = 18%) — see `TAX_RATE_UNIT` in
 * `finance.constants.ts` for why.
 *
 * `effective_from` / `effective_to` give a rate a validity window. This matters
 * because a tax line snapshots the rate it applied, so a rate change must be a NEW
 * row rather than an edit of the old one; without a window the table could not
 * express "this rate applied until 30 June" at all.
 *
 * `is_inclusive` is per rate, not per organization: a tenant can legitimately
 * operate an exclusive regime for some taxes and an inclusive one for others (for
 * example an inclusive retail tax alongside an exclusive service tax).
 */
@Entity('FINANCE_TAX_RATES')
@Index(['organization_id', 'code'], { unique: true })
@Index(['organization_id', 'is_active'])
export class TaxRate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  /** Human-readable name, e.g. "GST". */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Stable machine key referenced by `InvoiceItem.tax_code`, unique per org. */
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  /** Percentage, e.g. `18.00` for 18%. NUMERIC(5,2) allows 0.00–999.99. */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  rate!: string;

  /** `true` when the tax is already contained in the line amount. */
  @Column({ type: 'boolean', default: false })
  is_inclusive!: boolean;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  /** First instant the rate may be applied. */
  @Column({ type: 'timestamptz' })
  effective_from!: Date;

  /** Last instant the rate may be applied; `null` means open-ended. */
  @Column({ type: 'timestamptz', nullable: true })
  effective_to?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
