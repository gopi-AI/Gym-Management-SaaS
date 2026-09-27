import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * P3-07 — `CRM_SLA_BREACHES`. Net-new (§9: not in the ERD).
 *
 * Append-only audit history: §11's pattern table is explicit that "refunds,
 * credit notes, SLA breaches and payout runs are append-only history", and §9
 * repeats it for this table ("Immutable history — breaches are never deleted").
 * Nothing in the service deletes or updates a breach except setting
 * `escalated_at`, which is the escalation transition itself.
 *
 * `follow_up_id` is nullable because a `first_response` breach belongs to the
 * lead, not to a follow-up (see `CRM_SLA_BREACH_TYPES`).
 */
@Entity('CRM_SLA_BREACHES')
@Index(['organization_id', 'lead_id'])
@Index(['sla_policy_id', 'follow_up_id', 'breach_type'])
export class SlaBreach {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ type: 'uuid' }) sla_policy_id!: string;
  @Column({ type: 'uuid' }) lead_id!: string;
  @Column({ type: 'uuid', nullable: true }) follow_up_id?: string | null;
  @Column({ type: 'timestamptz' }) breached_at!: Date;
  @Column({ length: 50 }) breach_type!: string;
  @Column({ type: 'timestamptz', nullable: true }) escalated_at?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) resolved_at?: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}
