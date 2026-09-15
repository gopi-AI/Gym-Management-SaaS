import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { TrainerCommissionStatus } from './trainer-commission-status.enum';

/**
 * Trainer commission for one enrollment (`PT_TRAINER_COMMISSIONS`, §1 / §12 Q2).
 *
 * **One row per enrollment** — keyed by `pt_enrollment_id`, NOT `pt_session_id`.
 * The unique index on `pt_enrollment_id` is the DB-level backstop for that
 * invariant; `PtEnrollmentsService.create()` is the only writer.
 *
 * `amount = package.price × commission_percent / 100`, computed ONCE at
 * enrollment creation and never recalculated (not per session, not on later
 * session completions).
 *
 * `status` is 3-state (`pending` / `earned` / `clawed_back`) and defaults to
 * `earned`. **Phase 2 sets it once and never transitions it** — there is no
 * clawback API, no cancellation handler and no worker in this module; the column
 * exists so Phase 3 refund/cancellation logic has something to act on.
 *
 * Two Phase 2 deviations from the §1 key-field list, both deliberate:
 *   - `organization_id` is added (NOT NULL) for the row-level org-scoping used by
 *     every other table in Phase 1/2. Without it, every commission query would
 *     have to join enrollments to establish tenancy.
 *   - `paid_at` / `paid_amount` are absent, as §1 explicitly requires.
 */
@Entity('PT_TRAINER_COMMISSIONS')
@Index(['pt_enrollment_id'], { unique: true })
@Index(['organization_id', 'trainer_id', 'status'])
@Index(['organization_id', 'earned_at'])
export class TrainerCommission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Added for row-level tenant scoping (see class docs). */
  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  /** One commission row per enrollment — enforced by a unique index. */
  @Column({ type: 'uuid' })
  pt_enrollment_id!: string;

  @Column({ type: 'uuid' })
  trainer_id!: string;

  /** NUMERIC(10,2), read back as a string. Computed once, at enrollment creation. */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: string;

  /** Copied from the package (Q4: currency is stored, never inferred). */
  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: TrainerCommissionStatus.EARNED,
  })
  status!: TrainerCommissionStatus;

  @Column({ type: 'timestamptz' })
  earned_at!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}