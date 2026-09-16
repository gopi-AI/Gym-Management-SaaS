import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { LOYALTY_REWARD_TYPE_VALUES } from '../loyalty.constants';

/**
 * Redemption reward (schema-only in Phase 2 — see §12 Q20).
 *
 * This entity is defined for forward-compatibility only. There is no CRUD
 * endpoint, no redemption workflow, and no consumer logic in Phase 2.
 * The `redeem()` method is not implemented.
 *
 * Schema per docs/phase2-scoping-plan.md §5 entity table.
 */
@Entity('LOYALTY_REWARDS')
@Index(['organization_id', 'is_active'])
export class LoyaltyReward {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Points required to redeem this reward. */
  @Column({ type: 'int' })
  points_cost!: number;

  @Column({
    type: 'varchar',
    length: 30,
    enum: LOYALTY_REWARD_TYPE_VALUES,
  })
  reward_type!: string;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  valid_from?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  valid_to?: Date | null;

  /** Nullable — rewards can be unlimited. */
  @Column({ type: 'int', nullable: true })
  stock?: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}