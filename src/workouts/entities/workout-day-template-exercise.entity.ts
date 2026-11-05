import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WorkoutDayTemplate } from './workout-day-template.entity';
import { ExerciseSection } from './exercise-section.enum';

/**
 * One prescribed exercise row inside a reusable workout-day template.
 *
 * Every field is trainer-authored. `duration_seconds` covers cardio/treadmill
 * and timed work; `distance_meters` covers distance-based cardio; `sets`/`reps`
 * cover strength work. All are optional because a trainer decides the complete
 * composition and amount of each activity.
 */
@Entity('WORKOUTS_WORKOUT_DAY_TEMPLATE_EXERCISES')
@Index(['day_template_id'])
export class WorkoutDayTemplateExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  day_template_id!: string;

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

  @ManyToOne(
    () => WorkoutDayTemplate,
    (template) => template.exercises,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'day_template_id' })
  day_template!: WorkoutDayTemplate;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
