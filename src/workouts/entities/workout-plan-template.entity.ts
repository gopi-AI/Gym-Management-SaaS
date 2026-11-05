import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { WorkoutPlanTemplateDay } from './workout-plan-template-day.entity';

/**
 * A reusable weekly workout-plan template (`WORKOUTS_WORKOUT_PLAN_TEMPLATES`).
 *
 * The ordered `days` are day-template references or rest markers. The schedule
 * is not restricted to Push/Pull/Legs — a trainer can build any split, repeat a
 * composition, or mark a day optional/rest.
 *
 * The plan template is a reusable blueprint only. Assigning it snapshots its
 * days into assignment-specific prescribed days, so later edits never change an
 * existing member's plan.
 */
@Entity('WORKOUTS_WORKOUT_PLAN_TEMPLATES')
@Index(['organization_id', 'name'])
export class WorkoutPlanTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @OneToMany(() => WorkoutPlanTemplateDay, (day) => day.plan_template, {
    cascade: true,
  })
  days!: WorkoutPlanTemplateDay[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
