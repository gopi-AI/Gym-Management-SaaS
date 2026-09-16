import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * A prescribed diet plan (`DIET_DIET_PLANS`).
 *
 * Org-scoped — every plan belongs to exactly one organization. A member can be
 * assigned multiple plans CONCURRENTLY via `DietPlanAssignment` (Q8 — "A member
 * can have an active weight-loss plan and a maintenance plan concurrently").
 *
 * `total_calories_per_day` is the plan's prescribed daily calorie target. It is
 * nullable — a plan need not prescribe a calorie number (e.g. a macro-only plan).
 */
@Entity('DIET_DIET_PLANS')
@Index(['organization_id', 'name'])
export class DietPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'int', nullable: true })
  total_calories_per_day?: number | null;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
