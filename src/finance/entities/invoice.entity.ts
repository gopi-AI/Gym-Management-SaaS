import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Invoice.
 *
 * Columns follow `docs/database-plan.md` (ERD `FINANCE_INVOICES`):
 *   id, organization_id, branch_id, member_id, membership_id, invoice_number,
 *   invoice_date, due_date, subtotal, tax_amount, total_amount, status, paid_at,
 *   created_at, updated_at
 *
 * Monetary columns use NUMERIC(15,2) per the database plan's Conventions
 * section ("Monetary values: NUMERIC(15, 2) for currency amounts").
 *
 * `status` follows the Invoice state machine in `docs/domain-map.md`:
 *   draft -> sent -> partially_paid -> paid
 *   draft | sent | partially_paid -> void
 *
 * The amount actually paid is NOT denormalised here: it is derived from the
 * succeeded payments linked to the invoice, so the payments table stays the
 * single source of truth and no schema column is invented.
 */
@Entity('FINANCE_INVOICES')
@Index(['organization_id', 'invoice_number'], { unique: true })
@Index(['organization_id', 'status'])
@Index(['member_id', 'invoice_date'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id?: string | null;

  @Column({ type: 'uuid' })
  @Index()
  member_id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  membership_id?: string | null;

  /** Per-organization sequential number (e.g. INV-000001). */
  @Column({ type: 'varchar', length: 50 })
  invoice_number!: string;

  @Column({ type: 'timestamptz' })
  invoice_date!: Date;

  @Column({ type: 'timestamptz' })
  due_date!: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  subtotal!: string;

  /**
   * Tax is explicitly OUT OF SCOPE for this Phase 1 pass. The column exists
   * because the database plan specifies it; it is always written as 0.00 and
   * has a follow-up ticket rather than a half-built tax engine.
   */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  tax_amount!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  total_amount!: string;

  @Column({ type: 'varchar', length: 50, default: 'draft' })
  status!: string;

  @Column({ type: 'timestamptz', nullable: true })
  paid_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
