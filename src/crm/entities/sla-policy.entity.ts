import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * P3-07 — `CRM_SLA_POLICIES`. Net-new: §9 states it does not exist in the ERD
 * ("grep confirms no `SLA_` table anywhere in `docs/database-plan.md`").
 *
 * Org-scoped because "SLAs differ per gym" (§9).
 *
 * `max_follow_ups_per_period` / `cap_period_days` implement the cap §9 requires
 * under "Scope risks": "the policy model must support a cap (max follow-ups per
 * lead per period), not just an interval." §9 names the requirement without
 * naming columns, so these two column names are a decision made here — flagged in
 * the P3-07 report. Both are optional: a null cap means no cap.
 */
@Entity('CRM_SLA_POLICIES')
@Index(['organization_id', 'is_active'])
export class SlaPolicy {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ length: 100 }) name!: string;
  /**
   * §9 gives this as "applies_to (lead stage/source)". Interpreted here as a
   * `CRM_LEAD_STAGES.key` the policy is limited to; null means "every lead".
   */
  @Column({ type: 'varchar', length: 50, nullable: true }) applies_to?: string | null;
  @Column({ type: 'int' }) first_response_hours!: number;
  @Column({ type: 'int' }) follow_up_interval_hours!: number;
  @Column({ type: 'int' }) escalation_after_hours!: number;
  @Column({ type: 'int', nullable: true }) max_follow_ups_per_period?: number | null;
  @Column({ type: 'int', default: 30 }) cap_period_days!: number;
  @Column({ type: 'boolean', default: true }) is_active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
}
