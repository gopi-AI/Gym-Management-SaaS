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
 * Join between a member and a diet plan (`DIET_DIET_PLAN_ASSIGNMENTS`, Q8).
 *
 * Multiple active plans are allowed concurrently for the SAME member (e.g. an
 * active weight-loss plan AND a maintenance plan), but the SAME
 * (member, diet_plan) pair cannot be double-assigned. Enforcement is
 * belt-and-suspenders, exactly like `WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS`:
 *   - Belt:  app-level check in `DietService.assignPlan()`.
 *   - Suspenders: partial unique index on `(member_id, diet_plan_id)`
 *     WHERE `status = 'active'` (migration 3248).
 */
@Entity('DIET_DIET_PLAN_ASSIGNMENTS')
@Index(['organization_id', 'member_id', 'status'])
@Index(['organization_id', 'diet_plan_id'])
export class DietPlanAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'uuid' })
  diet_plan_id!: string;

  @Column({ type: 'varchar', length: 100 })
  assigned_by!: string;

  @Column({ type: 'timestamptz' })
  assigned_at!: Date;

  @Column({ type: 'date' })
  start_date!: string;

  @Column({ type: 'date', nullable: true })
  end_date?: string | null;

  @Column({ type: 'varchar', length: 50 })
  status!: AssignmentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
