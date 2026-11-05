import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { WorkoutSessionExercise } from './workout-session-exercise.entity';
import { WorkoutSessionStatus } from './workout-session-status.enum';

/**
 * A logged workout session (self-directed or PT-supervised).
 *
 * The session lifecycle (`status`) is separate from the prescribed plan-day
 * lifecycle: finishing a session never approves a plan day, and cancelling a
 * session never expires the pending day.
 *
 * Multiple sessions may point at the same `prescribed_day_id`; they contribute
 * to one prescribed day rather than creating duplicates. `deleted_at` is the
 * trainer soft-delete marker — deleted sessions are excluded from ordinary
 * member history but the row is retained.
 */
@Entity('WORKOUTS_WORKOUT_SESSIONS')
@Index(['organization_id', 'member_id', 'session_date'])
@Index(['assignment_id'])
@Index(['prescribed_day_id'])
@Index(['organization_id', 'member_id', 'status'])
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

  /** The prescribed day this session contributes to (nullable for standalone). */
  @Column({ type: 'uuid', nullable: true })
  prescribed_day_id?: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: WorkoutSessionStatus.IN_PROGRESS,
  })
  status!: WorkoutSessionStatus;

  @Column({ type: 'date' })
  session_date!: string;

  /** Authenticated user who logged the session (audit). */
  @Column({ type: 'uuid', nullable: true })
  created_by?: string | null;

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

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at?: Date | null;

  /** Trainer soft-delete metadata. No reason is required. */
  @Column({ type: 'timestamptz', nullable: true })
  deleted_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deleted_by?: string | null;

  @OneToMany(
    () => WorkoutSessionExercise,
    (sessionExercise) => sessionExercise.session,
    { cascade: true },
  )
  session_exercises!: WorkoutSessionExercise[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}