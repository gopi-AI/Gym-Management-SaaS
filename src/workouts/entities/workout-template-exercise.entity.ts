import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WorkoutTemplate } from './workout-template.entity';

/**
 * Join entity linking an exercise to a template with prescribed sets/reps/order.
 */
@Entity('WORKOUTS_WORKOUT_TEMPLATE_EXERCISES')
export class WorkoutTemplateExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  template_id!: string;

  @Column({ type: 'uuid' })
  exercise_id!: string;

  @Column({ type: 'int', nullable: true })
  sets?: number | null;

  @Column({ type: 'int', nullable: true })
  reps?: number | null;

  /** Nullable — some exercises are bodyweight-only (no weight prescribed). */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  weight_template?: number | null;

  @Column({ type: 'int', nullable: true })
  rest_seconds?: number | null;

  @Column({ type: 'int' })
  sort_order!: number;

  /** Nullable — some templates don't prescribe a specific day of week. */
  @Column({ type: 'int', nullable: true })
  day_of_week?: number | null;

  @ManyToOne(() => WorkoutTemplate, (template) => template.template_exercises)
  @JoinColumn({ name: 'template_id' })
  template!: WorkoutTemplate;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}