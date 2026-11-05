import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ProgressReviewDecision } from './progress-review-decision.enum';

/**
 * A persistent 30–45-day trainer-led workout progress review
 * (`WORKOUTS_PROGRESS_REVIEWS`).
 *
 * The review is a historical record: progress counts, measurement snapshots and
 * the trainer's assessment are frozen at review time. Recording a review does
 * not expire, advance or modify the assignment; a new plan requires an
 * explicit assignment.
 */
@Entity('WORKOUTS_PROGRESS_REVIEWS')
@Index(['organization_id', 'member_id', 'review_date'])
export class WorkoutProgressReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'uuid' })
  assignment_id!: string;

  @Column({ type: 'date' })
  review_date!: string;

  @Column({ type: 'date' })
  period_start!: string;

  @Column({ type: 'date' })
  period_end!: string;

  /** Trainer-approved finished days at review time. */
  @Column({ type: 'int' })
  approved_days!: number;

  /** Non-rest prescribed days at review time. */
  @Column({ type: 'int' })
  prescribed_days!: number;

  @Column({ type: 'int' })
  progress_percentage!: number;

  /** Counts by plan-day status at review time. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  plan_day_summary!: Record<string, number>;

  /** Snapshot of the member's real gym attendance for the review period. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attendance_summary!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  results?: string | null;

  @Column({ type: 'text', nullable: true })
  fitness_improvements?: string | null;

  @Column({ type: 'text', nullable: true })
  goal_assessment?: string | null;

  @Column({ type: 'text', nullable: true })
  observations?: string | null;

  @Column({ type: 'text', nullable: true })
  recommendations?: string | null;

  @Column({ type: 'varchar', length: 20 })
  decision!: ProgressReviewDecision;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by?: string | null;

  /** Set when the review explicitly creates the next assignment. */
  @Column({ type: 'uuid', nullable: true })
  resulting_assignment_id?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
