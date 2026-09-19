import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * P3-02 — a refund against a payment (`FINANCE_REFUNDS`).
 *
 * Columns follow `docs/database-plan.md` (ERD `FINANCE_REFUNDS`):
 *   id, payment_id, reason, amount, refund_date, status, created_at
 *
 * `organization_id` is the approved addition, the same one `InvoiceItem` carries:
 * every tenant table in this codebase is org-scoped, so refunds can be listed for
 * the authorized organization without joining through `FINANCE_PAYMENTS`.
 *
 * **A refund attaches to a PAYMENT, not an invoice** (§2's table). That is what
 * makes the invariant expressible: `SUM(refunds.amount) <= payment.amount`. A
 * refund against an invoice could not be checked against anything.
 *
 * `status` values are `REFUND_STATUS` (`pending | succeeded | failed`). P3-02
 * writes `succeeded` directly — refunds are staff-initiated and recorded manually,
 * per the §15 Q5 ruling — and `pending` is reserved for the gateway-initiated path
 * P3-03 adds. No `updated_at`: a refund is a financial record and is not edited;
 * a state change (P3-03 driving `pending -> succeeded`) is a status transition on
 * an append-oriented row, not a general-purpose edit.
 */
@Entity('FINANCE_REFUNDS')
@Index(['organization_id', 'status'])
@Index(['payment_id'])
@Index(['organization_id', 'refund_date'])
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The organization that owns the refund. Taken from the authorized tenant
   * context, never from the request body.
   */
  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  /** The payment being refunded. Refunds are validated against its total. */
  @Column({ type: 'uuid' })
  payment_id!: string;

  /**
   * Why the money was returned. Required, not optional: a refund with no recorded
   * basis is unauditable, and this is the only place the reason is captured.
   */
  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  /**
   * When the money went back. Defaults to now, matching `payment_date`, but is
   * settable so a refund recorded after the fact can carry its real date rather
   * than the date it was typed in.
   */
  @Column({ type: 'timestamptz' })
  refund_date!: Date;

  /** pending | succeeded | failed (see REFUND_STATUS). */
  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
