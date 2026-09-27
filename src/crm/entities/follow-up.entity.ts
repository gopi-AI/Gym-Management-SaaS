import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * P3-07 — `CRM_FOLLOW_UPS`.
 *
 * §9 describes this table as an *enhancement* of one §8 was meant to create, but
 * no migration ever created it (P3-06 shipped `CRM_LEAD_SOURCES`,
 * `CRM_LEAD_STAGES`, `CRM_LEADS`, `CRM_LEAD_ACTIVITIES` and `CRM_CONVERSIONS`
 * only), so `CreateCrmFollowUpsAndSla1788965263268` creates it in full — with
 * `organization_id` and `created_at` included from the start rather than added
 * later. §9's design caution is explicit that `created_at` is required for SLA
 * calculation: "was this follow-up overdue?" needs to know when it was
 * *scheduled*, which `follow_up_date` alone cannot distinguish from when it was
 * *due*.
 *
 * Kept org-scoped only, matching §9's field list (no `branch_id`) — a follow-up
 * is reached through its lead, and the lead carries the branch.
 */
@Entity('CRM_FOLLOW_UPS')
@Index(['organization_id', 'lead_id'])
@Index(['organization_id', 'sla_status'])
export class FollowUp {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ type: 'uuid' }) lead_id!: string;
  /** Staff-entered result of the contact. Required at completion (§9, "SLA gaming"). */
  @Column({ type: 'text', nullable: true }) outcome?: string | null;
  /** When the follow-up is actionable — drives `GET /v1/follow-ups/due`. */
  @Column({ type: 'timestamptz' }) follow_up_date!: Date;
  /** SLA deadline. Null/absent falls back to `follow_up_date` (see `followUpDeadline`). */
  @Column({ type: 'timestamptz', nullable: true }) due_at?: Date | null;
  @Column({ type: 'uuid', nullable: true }) sla_policy_id?: string | null;
  @Column({ length: 50, default: 'pending' }) sla_status!: string;
  @Column({ type: 'timestamptz', nullable: true }) escalated_at?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completed_at?: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}
