import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { WorkoutDayTemplateExercise } from './workout-day-template-exercise.entity';

/**
 * A reusable single workout-day template (`WORKOUTS_WORKOUT_DAY_TEMPLATES`).
 *
 * This is deliberately NOT the same concept as `WorkoutTemplate` (the legacy
 * flat Phase 2 template), an assignment, a prescribed day, or a session:
 *   - a day template is authored once and copied/reused;
 *   - copying it produces an independent row (template edits never cascade);
 *   - assigning a plan snapshots its composition into prescribed days.
 */
@Entity('WORKOUTS_WORKOUT_DAY_TEMPLATES')
@Index(['organization_id', 'name'])
export class WorkoutDayTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'int', nullable: true })
  estimated_duration_minutes?: number | null;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @OneToMany(
    () => WorkoutDayTemplateExercise,
    (exercise) => exercise.day_template,
    { cascade: true },
  )
  exercises!: WorkoutDayTemplateExercise[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
