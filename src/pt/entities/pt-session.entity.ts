import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PTSessionStatus } from './pt-session-status.enum';

/**
 * A trainer-led PT session (`PT_PT_SESSIONS`, §1 / §12 Q1, Q3, Q27).
 *
 * **Fully decoupled from attendance (Q3)**: completing a PT session writes no
 * attendance row and calls no attendance service. Gym check-ins are recorded by
 * the attendance module only when the member independently checks in.
 *
 * **Independent of `WorkoutSession` (Q27)**: `workout_session_id` is an optional
 * FK, set ONLY when a trainer explicitly links a session to an already-logged
 * `WorkoutSession`. This module never auto-creates a `WorkoutSession` and never
 * auto-populates the link.
 *
 * `member_id` is denormalized from the enrollment (the session's member is the
 * enrollment's member) so session listings and attendance-independent reporting
 * do not require a join. It is always copied from the enrollment, never accepted
 * from the request body.
 */
@Entity('PT_PT_SESSIONS')
@Index(['organization_id', 'enrollment_id'])
@Index(['organization_id', 'trainer_id', 'scheduled_start'])
@Index(['organization_id', 'member_id', 'scheduled_start'])
export class PTSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid' })
  branch_id!: string;

  /** Copied from the enrollment — never client-supplied. */
  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'uuid' })
  trainer_id!: string;

  @Column({ type: 'uuid' })
  enrollment_id!: string;

  @Column({ type: 'timestamptz' })
  scheduled_start!: Date;

  @Column({ type: 'timestamptz' })
  scheduled_end!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  actual_start?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  actual_end?: Date | null;

  @Column({ type: 'varchar', length: 20, default: PTSessionStatus.SCHEDULED })
  status!: PTSessionStatus;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /**
   * Optional FK to `WORKOUTS_WORKOUT_SESSIONS` (Q27). Nullable, manually set via
   * `PtSessionsService.linkWorkoutSession()`, never auto-populated.
   */
  @Column({ type: 'uuid', nullable: true })
  workout_session_id?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}