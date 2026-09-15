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
 * This is the data from which progress is computed: `sets_completed` vs.
 * prescribed sets, `reps_completed` vs. prescribed reps. There is deliberately
 * NO `volume` (sets × reps × weight) field — cumulative weight-based metrics
 * were explicitly rejected per Q7. RPE is optional and non-driving.
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