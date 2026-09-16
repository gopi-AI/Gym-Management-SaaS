import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { LOYALTY_TRIGGER_EVENT_VALUES, DEFAULT_MAX_PER_DAY } from '../loyalty.constants';

/**
 * Configuration rule for awarding loyalty points.
 *
 * Each rule defines a trigger event, the flat points awarded per occurrence,
 * and a per-member-per-day cap. Rules are org-scoped and can be deactivated.
 *
 * Schema per docs/phase2-scoping-plan.md §5 entity table.
 *
 * Exactly two trigger_event values in Phase 2: `check_in` and `workout_logged`
 * (see §12 Q17). PT session completion and referrals are explicitly excluded.
 * No formula/multiplier engine — flat `points_per_event` only.
 */
@Entity('LOYALTY_RULES')
@Index(['organization_id', 'trigger_event', 'is_active'])
export class LoyaltyRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({
    type: 'varchar',
    length: 30,
    enum: LOYALTY_TRIGGER_EVENT_VALUES,
  })
  trigger_event!: string;

  /** Flat integer points awarded per matching event. */
  @Column({ type: 'int' })
  points_per_event!: number;

  /** Maximum earnings per member per calendar day for this rule. */
  @Column({ type: 'int', default: DEFAULT_MAX_PER_DAY })
  max_per_day!: number;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}