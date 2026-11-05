import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ExerciseSection } from './exercise-section.enum';

/**
 * Assignment-specific snapshot of one prescribed exercise
 * (`WORKOUTS_PRESCRIBED_DAY_EXERCISES`).
 *
 * The prescription fields are copied from the source day template at assignment
 * time. Later edits to the reusable template therefore cannot change an
 * existing member's plan. `exercise_name_snapshot` additionally preserves the
 * name used when the plan was assigned.
 */
@Entity('WORKOUTS_PRESCRIBED_DAY_EXERCISES')
@Index(['prescribed_day_id'])
export class PrescribedWorkoutDayExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  prescribed_day_id!: string;

  @Column({ type: 'uuid' })
  exercise_id!: string;

  @Column({ type: 'varchar', length: 20, default: ExerciseSection.STRENGTH })
  section!: ExerciseSection;

  @Column({ type: 'int', nullable: true })
  sets?: number | null;

  @Column({ type: 'int', nullable: true })
  reps?: number | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  weight_template?: number | null;

  @Column({ type: 'int', nullable: true })
  rest_seconds?: number | null;

  @Column({ type: 'int', nullable: true })
  duration_seconds?: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  distance_meters?: number | null;

  @Column({ type: 'text', nullable: true })
  instructions?: string | null;

  @Column({ type: 'int' })
  sort_order!: number;

  @Column({ type: 'varchar', length: 255 })
  exercise_name_snapshot!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
