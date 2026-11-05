import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * An immutable member submission for one prescribed workout day
 * (`WORKOUTS_PLAN_DAY_SUBMISSIONS`).
 *
 * A day may receive several submissions over time (e.g. the trainer asks for
 * the remaining exercises). Every submission is retained; none is overwritten.
 * The reported exercise results are snapshotted into
 * `WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES`, so later session soft-deletion
 * cannot rewrite what the member reported or what the trainer reviewed.
 */
@Entity('WORKOUTS_PLAN_DAY_SUBMISSIONS')
@Index(['organization_id', 'prescribed_day_id', 'submitted_at'])
export class PlanDaySubmission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  prescribed_day_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  /** Authenticated user who submitted, when an identity is available. */
  @Column({ type: 'uuid', nullable: true })
  submitted_by?: string | null;

  @Column({ type: 'timestamptz' })
  submitted_at!: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
