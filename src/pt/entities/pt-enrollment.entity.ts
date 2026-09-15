import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PTEnrollmentStatus } from './pt-enrollment-status.enum';

/**
 * A member's purchased PT package assignment (`PT_PT_ENROLLMENTS`, §1 / §12 Q1).
 *
 * Lifecycle (Q1): `sessions_used` auto-increments when a `PTSession` transitions
 * to `completed`, and when `sessions_used` reaches `session_count` the enrollment
 * auto-transitions to `completed` — both in the SAME unit of work as the session
 * write (see `PtSessionsService.completeSession`). A `completed` enrollment
 * rejects further booking, which is what "prevents booking against an exhausted
 * package" means in §1.
 *
 * `session_count` is SNAPSHOTTED from the package at enrollment time, so editing
 * the package afterwards cannot retroactively change an existing enrollment's
 * purchased quantity (same snapshot convention as `Membership.price_at_signup`).
 *
 * `commission_percent` is a nullable per-enrollment override; when null the
 * package default is used at commission computation time (§1).
 */
@Entity('PT_PT_ENROLLMENTS')
@Index(['organization_id', 'member_id', 'status'])
@Index(['organization_id', 'trainer_id'])
export class PTEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'uuid' })
  package_id!: string;

  @Column({ type: 'uuid' })
  trainer_id!: string;

  /** Per-enrollment override of `PTPackage.commission_percent` (nullable). */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commission_percent?: string | null;

  @Column({ type: 'date' })
  start_date!: string;

  @Column({ type: 'date', nullable: true })
  end_date?: string | null;

  /** Sessions consumed. Maintained ONLY by session completion (single write path). */
  @Column({ type: 'int', default: 0 })
  sessions_used!: number;

  /** Snapshot of `PTPackage.session_count` at enrollment time. */
  @Column({ type: 'int' })
  session_count!: number;

  @Column({ type: 'varchar', length: 20, default: PTEnrollmentStatus.ACTIVE })
  status!: PTEnrollmentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  /**
   * Remaining sessions — DERIVED, never a persisted column.
   *
   * §1's key-field list stores only `sessions_used` and `session_count`; §12 Q26
   * needs a `sessions_remaining > 0` predicate for the Member 360 "Book PT" quick
   * action. It is therefore computed here (single source of truth = the two
   * stored columns) instead of being denormalized, so it can never drift.
   */
  get sessions_remaining(): number {
    return Math.max(0, this.session_count - this.sessions_used);
  }
}