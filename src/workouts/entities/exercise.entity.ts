import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ExerciseCategory } from './exercise-category.enum';

/**
 * The single, org-scoped exercise library (Q5).
 *
 * Every exercise belongs to exactly ONE organization via a NON-NULL
 * `organization_id` FK. There is NO global/shared library and NO seed-exercises
 * concept — each gym builds its own catalog from scratch. This is the only
 * exercise table in the entire system; there is deliberately no `PT_EXERCISES` or
 * any parallel table (resolved naming collision — Workouts owns all exercise
 * content and PT depends on Workouts via `WorkoutsService.assignPlan()`).
 */
@Entity('WORKOUTS_EXERCISES')
@Index(['organization_id', 'name'])
export class Exercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  category?: ExerciseCategory | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  muscle_group?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  equipment_needed?: string | null;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}