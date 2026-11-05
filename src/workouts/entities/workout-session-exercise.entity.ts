import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WorkoutSession } from './workout-session.entity';

/**
 * Per-exercise log within a workout session.
 *
 * A regular member records `completed` (a checkbox); a PT member records the
 * actual `sets_completed`, `reps_completed` and `weight_used`. Both shapes are
 * optional on the row because not every exercise is logged in every session.
 *
 * `prescribed_day_exercise_id` ties the log to the assignment snapshot so a
 * plan day can be reported across multiple sessions without inflating counts.
 * There is deliberately NO `volume` (sets × reps × weight) field — cumulative
 * weight-based metrics were explicitly rejected per Q7. RPE is optional.
 */
@Entity('WORKOUTS_WORKOUT_SESSION_EXERCISES')
@Index(['session_id'])
export class WorkoutSessionExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  session_id!: string;

  @Column({ type: 'uuid' })
  exercise_id!: string;

  /** The prescribed-day snapshot row this log fulfils (nullable for standalone). */
  @Column({ type: 'uuid', nullable: true })
  prescribed_day_exercise_id?: string | null;

  /** Regular-member checkbox: exercise completed / not completed. */
  @Column({ type: 'boolean', nullable: true })
  completed?: boolean | null;

  /** Actual sets completed. */
  @Column({ type: 'int', nullable: true })
  sets_completed?: number | null;

  /** Actual reps completed. */
  @Column({ type: 'int', nullable: true })
  reps_completed?: number | null;

  /** Actual weight used. */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  weight_used?: number | null;

  /** Rate of Perceived Exertion (1-10 scale), optional. */
  @Column({ type: 'int', nullable: true })
  rpe?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @ManyToOne(() => WorkoutSession, (session) => session.session_exercises)
  @JoinColumn({ name: 'session_id' })
  session!: WorkoutSession;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}