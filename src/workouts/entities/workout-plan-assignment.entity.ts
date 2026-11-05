import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { AssignmentStatus } from './assignment-status.enum';
import { AssignmentLoggingMode } from './assignment-logging-mode.enum';

/**
 * Join between a member and a plan source — a "workout plan assignment" (Q6).
 *
 * A member may hold multiple active plans concurrently (e.g. strength +
 * cardio), but the SAME legacy template cannot be double-assigned. A partial
 * unique index on `(member_id, template_id) WHERE status = 'active'` prevents
 * only duplicate active assignments of the exact same legacy template while
 * allowing different plans in parallel.
 *
 * Two source shapes are supported:
 *   - legacy `template_id` → a flat `WorkoutTemplate` (PT compatibility);
 *   - `plan_template_id` → a reusable weekly `WorkoutPlanTemplate`.
 *
 * Either way, assignment creates an assignment-specific snapshot in
 * `WORKOUTS_PRESCRIBED_DAYS` / `WORKOUTS_PRESCRIBED_DAY_EXERCISES`. Editing the
 * reusable source afterwards never changes this assignment.
 */
@Entity('WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS')
@Index(['organization_id', 'member_id', 'status'])
@Index(['organization_id', 'template_id'])
@Index(['organization_id', 'plan_template_id'])
export class WorkoutPlanAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  /** Legacy flat `WorkoutTemplate` source. Null for plan-template assignments. */
  @Column({ type: 'uuid', nullable: true })
  template_id?: string | null;

  /** Reusable weekly plan template source. Null for legacy assignments. */
  @Column({ type: 'uuid', nullable: true })
  plan_template_id?: string | null;

  /** Regular members use simple checkboxes; PT members use detailed logging. */
  @Column({
    type: 'varchar',
    length: 20,
    default: AssignmentLoggingMode.SIMPLE,
  })
  logging_mode!: AssignmentLoggingMode;

  /** When the assignment-specific prescribed-day snapshot was written. */
  @Column({ type: 'timestamptz', nullable: true })
  snapshot_taken_at?: Date | null;

  /** The progress review that led to this assignment, when one did. */
  @Column({ type: 'uuid', nullable: true })
  progress_review_id?: string | null;

  /** User ID (or "system" / "self") who assigned the plan. */
  @Column({ type: 'varchar', length: 100 })
  assigned_by!: string;

  @Column({ type: 'timestamptz' })
  assigned_at!: Date;

  @Column({ type: 'date' })
  start_date!: string;

  @Column({ type: 'date', nullable: true })
  end_date?: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'active',
  })
  status!: AssignmentStatus;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}