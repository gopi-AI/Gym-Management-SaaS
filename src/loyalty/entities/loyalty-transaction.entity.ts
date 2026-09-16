import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { LOYALTY_TRANSACTION_TYPE_VALUES } from '../loyalty.constants';

/**
 * Immutable loyalty transaction (append-only ledger).
 *
 * Every point movement (earn, expire, redeem, adjust) is a new row. No row is
 * ever mutated after creation. `remaining_points` starts equal to `points` and
 * is decremented by the expiry-sweep worker (see §12 Q22).
 *
 * Schema per docs/phase2-scoping-plan.md §5 entity table.
 *
 * `expires_at` is computed at earn time as `created_at + org.points_expiry_days`.
 * `redeem` transaction_type exists in the enum for Phase 3 compatibility but
 * is not produced in Phase 2 (see §12 Q20).
 */
@Entity('LOYALTY_TRANSACTIONS')
@Index(['account_id', 'created_at'])
@Index(['account_id', 'expires_at'])
@Index(['expires_at', 'remaining_points'])
export class LoyaltyTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK → LoyaltyAccount.id */
  @Column({ type: 'uuid' })
  @Index()
  account_id!: string;

  @Column({
    type: 'varchar',
    length: 20,
    enum: LOYALTY_TRANSACTION_TYPE_VALUES,
  })
  transaction_type!: string;

  /** Absolute number of points in this transaction (always positive). */
  @Column({ type: 'int' })
  points!: number;

  /**
   * Points still available in this transaction (starts = points, decremented
   * by expiry). The expiry-sweep worker reduces this to zero when points
   * expire. `remaining_points` is the per-transaction FIFO balance.
   */
  @Column({ type: 'int' })
  remaining_points!: number;

  /** Type of the reference entity, e.g. 'check_in', 'workout_session', 'expiry_sweep'. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  reference_type?: string | null;

  /** ID of the reference entity (attendance event id, workout session id, etc.). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  reference_id?: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Computed at earn time: created_at + org.points_expiry_days. Null for expire/redeem/adjust. */
  @Column({ type: 'timestamptz', nullable: true })
  expires_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}