import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Loyalty account for a member within an organization.
 *
 * One account per member per organization. The account is auto-created on the
 * member's first point-earning event. Balance is a denormalized materialized
 * counter updated atomically with each LoyaltyTransaction insert.
 *
 * Schema per docs/phase2-scoping-plan.md §5 entity table (with `created_at`
 * added for consistency with every other entity in the codebase).
 *
 * `tier` column exists but is NULL/unused in Phase 2 (see §12 Q19).
 * `lifetime_points_redeemed` remains 0 in Phase 2 (redemption deferred to
 * Phase 3, see §12 Q20).
 */
@Entity('LOYALTY_ACCOUNTS')
@Index(['organization_id', 'member_id'], { unique: true })
export class LoyaltyAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  member_id!: string;

  /** Current materialized balance (sum of all earn/expire/redeem/adjust). */
  @Column({ type: 'int', default: 0 })
  balance!: number;

  /** Cumulative points earned (never decremented). */
  @Column({ type: 'int', default: 0 })
  lifetime_points_earned!: number;

  /** Cumulative points redeemed (unused in Phase 2, defaults to 0). */
  @Column({ type: 'int', default: 0 })
  lifetime_points_redeemed!: number;

  /** Nullable — no tier system in Phase 2 (see §12 Q19). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  tier?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}