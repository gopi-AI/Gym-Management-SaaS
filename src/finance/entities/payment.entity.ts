import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Payment.
 *
 * Columns follow `docs/database-plan.md` (ERD `FINANCE_PAYMENTS`):
 *   id, organization_id, branch_id, invoice_id, payment_method, transaction_id,
 *   amount, payment_date, status, idempotency_key (unique), created_at
 *
 * Approved additions:
 *   - `member_id`: the database plan's own Indexing plan requires
 *     `idx_payments_member_time ON payments(member_id, payment_date)` even
 *     though the ERD block omits the column; without it that index (and the
 *     "payments by member" lookup) is impossible.
 *   - `retry_count`, `last_attempt_at`, `next_retry_at`, `last_failure_reason`:
 *     required by the Phase 1 payment retry worker so a retry schedule survives
 *     a process restart (no in-memory state).
 *
 * `status` values used by this module: pending | succeeded | failed.
 * Manual front-desk recording writes `succeeded` immediately. Gateway
 * integration (Phase 3) will create `pending` payments and drive them through
 * the same retry columns without a schema rewrite.
 *
 * The ERD gives this table no `updated_at`, so retry bookkeeping is expressed
 * through the explicit attempt columns above rather than a modification stamp.
 */
@Entity('FINANCE_PAYMENTS')
@Index(['idempotency_key'], { unique: true })
@Index(['member_id', 'payment_date'])
@Index(['organization_id', 'status'])
@Index(['status', 'next_retry_at'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  /** Branch where the payment was taken; null for gateway/online payments. */
  @Column({ type: 'uuid', nullable: true })
  branch_id?: string | null;

  /** Denormalised from the invoice for "payments by member" reporting. */
  @Column({ type: 'uuid' })
  @Index()
  member_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  invoice_id!: string;

  /** cash | card | bank_transfer | other (see PAYMENT_METHODS). */
  @Column({ type: 'varchar', length: 50 })
  payment_method!: string;

  /** Gateway/provider reference. Null for manual front-desk payments. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  transaction_id?: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Column({ type: 'timestamptz' })
  payment_date!: Date;

  /** pending | succeeded | failed (see PAYMENT_STATUS). */
  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string;

  /**
   * Client-supplied or server-generated idempotency key. Unique across the
   * table, which is the database plan's documented duplicate-payment guard.
   */
  @Column({ type: 'varchar', length: 255 })
  idempotency_key!: string;

  /** Number of retry attempts already performed (payment retry worker). */
  @Column({ type: 'int', default: 0 })
  retry_count!: number;

  /** Timestamp of the most recent retry attempt. */
  @Column({ type: 'timestamptz', nullable: true })
  last_attempt_at?: Date | null;

  /**
   * When the next retry becomes due. NULL means "not scheduled for retry",
   * which is how terminal (succeeded) payments are parked.
   */
  @Column({ type: 'timestamptz', nullable: true })
  next_retry_at?: Date | null;

  /** Human-readable reason of the most recent failure. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  last_failure_reason?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
