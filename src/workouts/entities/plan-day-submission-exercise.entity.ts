import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Snapshot of one exercise result inside a member submission
 * (`WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES`).
 *
 * `completed` is the regular-member checkbox; the actual sets/reps/weight are
 * retained for PT members (and for regular members if the UI ever supplies
 * them). These rows are historical evidence and are never updated.
 */
@Entity('WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES')
@Index(['submission_id'])
@Index(['prescribed_day_exercise_id'])
export class PlanDaySubmissionExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  submission_id!: string;

  @Column({ type: 'uuid' })
  prescribed_day_exercise_id!: string;

  @Column({ type: 'boolean', nullable: true })
  completed?: boolean | null;

  @Column({ type: 'int', nullable: true })
  sets_completed?: number | null;

  @Column({ type: 'int', nullable: true })
  reps_completed?: number | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  weight_used?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
