import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { PlanDayStatus } from './plan-day-status.enum';

/**
 * An assignment-specific snapshot of one prescribed workout day
 * (`WORKOUTS_PRESCRIBED_DAYS`).
 *
 * This is the stable identity a member's sessions, submissions and trainer
 * reviews attach to. Multiple sessions may contribute to the SAME prescribed
 * day; the day is never duplicated per session.
 *
 * `sequence_order` is the rolling sequence position, not a calendar date. A
 * missed day never expires: it stays first in the sequence until the trainer
 * approves it, and later days shift behind it.
 *
 * Rest marker rows (`is_rest_day = true`) are snapshotted for display but
 * excluded from the denominator and from the active sequence.
 */
@Entity('WORKOUTS_PRESCRIBED_DAYS')
@Unique(['assignment_id', 'sequence_order'])
@Index(['organization_id', 'assignment_id', 'status'])
export class PrescribedWorkoutDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  assignment_id!: string;

  @Column({ type: 'int' })
  sequence_order!: number;

  /** Nullable — a rest marker has no source day template. */
  @Column({ type: 'uuid', nullable: true })
  source_day_template_id?: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  day_label?: string | null;

  @Column({ type: 'boolean', default: false })
  is_rest_day!: boolean;

  @Column({ type: 'boolean', default: false })
  is_optional!: boolean;

  @Column({
    type: 'varchar',
    length: 30,
    default: PlanDayStatus.PENDING,
  })
  status!: PlanDayStatus;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  approved_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
