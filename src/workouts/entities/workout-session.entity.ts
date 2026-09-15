import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { WorkoutSessionExercise } from './workout-session-exercise.entity';

/**
 * A logged workout session (self-directed or PT-supervised).
 *
 * Progress is computed from `WorkoutSessionExercise` completion data — there
 * is NO cumulative-volume field or calculation per Q7 (explicitly rejected).
 * Optional RPE exists as a non-driving intensity measure.
 */
@Entity('WORKOUTS_WORKOUT_SESSIONS')
@Index(['organization_id', 'member_id', 'session_date'])
@Index(['assignment_id'])
export class WorkoutSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  /** Nullable — a session can be logged without being linked to a specific template. */
  @Column({ type: 'uuid', nullable: true })
  template_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignment_id?: string | null;

  @Column({ type: 'date' })
  session_date!: string;

  @Column({ type: 'timestamptz', nullable: true })
  started_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date | null;

  @Column({ type: 'int', nullable: true })
  duration_minutes?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /** Optional mood/energy level (1-10 scale). */
  @Column({ type: 'int', nullable: true })
  mood?: number | null;

  @OneToMany(
    () => WorkoutSessionExercise,
    (sessionExercise) => sessionExercise.session,
    { cascade: true },
  )
  session_exercises!: WorkoutSessionExercise[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}