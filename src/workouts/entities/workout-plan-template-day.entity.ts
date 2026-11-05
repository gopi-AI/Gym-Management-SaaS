import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { WorkoutPlanTemplate } from './workout-plan-template.entity';
import { WorkoutDayTemplate } from './workout-day-template.entity';

/**
 * One ordered slot in a reusable weekly plan template.
 *
 * `day_order` is the stable sequence position. A slot is either a reference to
 * a reusable day template or a rest marker (`is_rest_day = true`). Rest markers
 * are display/authoring metadata only: they are snapshotted for the member's
 * schedule but excluded from the prescribed-day denominator.
 */
@Entity('WORKOUTS_WORKOUT_PLAN_TEMPLATE_DAYS')
@Unique(['plan_template_id', 'day_order'])
@Index(['plan_template_id'])
export class WorkoutPlanTemplateDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  plan_template_id!: string;

  @Column({ type: 'uuid', nullable: true })
  day_template_id?: string | null;

  @Column({ type: 'int' })
  day_order!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  day_label?: string | null;

  @Column({ type: 'boolean', default: false })
  is_rest_day!: boolean;

  /** Trainer may mark a training day optional (e.g. a Saturday variation). */
  @Column({ type: 'boolean', default: false })
  is_optional!: boolean;

  @ManyToOne(() => WorkoutPlanTemplate, (plan) => plan.days, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_template_id' })
  plan_template!: WorkoutPlanTemplate;

  @ManyToOne(() => WorkoutDayTemplate, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'day_template_id' })
  day_template?: WorkoutDayTemplate | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
