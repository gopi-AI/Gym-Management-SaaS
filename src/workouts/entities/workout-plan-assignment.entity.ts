import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { AssignmentStatus } from './assignment-status.enum';

/**
 * Join between a member and a template — a "workout plan assignment" (Q6).
 *
 * Multiple active plans are allowed concurrently for the same member (e.g.
 * strength + cardio), but the SAME template cannot be double-assigned. A
 * partial unique index on `(member_id WHERE status = 'active')` would
 * conflict with this business rule, so the unique enforcement is on
 * `(member_id, template_id) WHERE status = 'active'` — preventing only
 * duplicate active assignments of the exact same template while allowing
 * different templates in parallel.
 */
@Entity('WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS')
@Index(['organization_id', 'member_id', 'status'])
@Index(['organization_id', 'template_id'])
export class WorkoutPlanAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'uuid' })
  template_id!: string;

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