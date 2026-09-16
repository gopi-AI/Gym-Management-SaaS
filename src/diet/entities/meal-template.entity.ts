import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { MealType } from './meal-type.enum';

/**
 * A reusable meal definition (`DIET_MEAL_TEMPLATES`).
 *
 * Belongs to a specific `DietPlan` (FK `diet_plan_id`). Macros
 * (calories, protein_g, carbs_g, fat_g) are the macro values PER SINGLE
 * SERVING. When a `NutritionLog` references a template, the log's macro columns
 * are computed as `template_value × servings` AT LOG TIME and SNAPSHOTTED onto
 * the log row (Q10 — "snapshotted, so future changes to the template don't
 * retroactively alter past logs").
 *
 * `organization_id` is denormalized from the diet plan on create so that all
 * diet queries are org-scoped without a join — the same denormalization pattern used
 * by every org-scoped entity in this codebase.
 */
@Entity('DIET_MEAL_TEMPLATES')
@Index(['organization_id', 'name'])
@Index(['diet_plan_id'])
export class MealTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  diet_plan_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 50 })
  meal_type!: MealType;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'int' })
  calories!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  protein_g!: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  carbs_g!: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  fat_g!: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  serving_size!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
