import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { WorkoutTemplateExercise } from './workout-template-exercise.entity';

/**
 * A named, reusable collection of exercises (a "workout plan").
 *
 * Org-scoped — every template belongs to exactly one organization. Multiple
 * members can be assigned this template via `WorkoutPlanAssignment`. This is
 * what a PT "plan" IS under the hood — PT does not own a parallel plan concept.
 */
@Entity('WORKOUTS_WORKOUT_TEMPLATES')
@Index(['organization_id', 'name'])
export class WorkoutTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  difficulty_level?: string | null;

  @Column({ type: 'int', nullable: true })
  estimated_duration_minutes?: number | null;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @OneToMany(
    () => WorkoutTemplateExercise,
    (templateExercise) => templateExercise.template,
    { cascade: true },
  )
  template_exercises!: WorkoutTemplateExercise[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}