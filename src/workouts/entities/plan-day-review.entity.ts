import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { PlanDayReviewDecision } from './plan-day-review-decision.enum';

/**
 * Immutable trainer review of a prescribed workout day
 * (`WORKOUTS_PLAN_DAY_REVIEWS`).
 *
 * The trainer's decision is authoritative: approving a partially completed day
 * (or a missed day) is valid and does not require a member submission. Reviews
 * are append-only; a later review never erases an earlier one.
 */
@Entity('WORKOUTS_PLAN_DAY_REVIEWS')
@Index(['organization_id', 'prescribed_day_id', 'decided_at'])
export class PlanDayReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  prescribed_day_id!: string;

  /** Nullable — a trainer may approve a day the member never submitted. */
  @Column({ type: 'uuid', nullable: true })
  submission_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by?: string | null;

  @Column({ type: 'varchar', length: 30 })
  decision!: PlanDayReviewDecision;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'timestamptz' })
  decided_at!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
