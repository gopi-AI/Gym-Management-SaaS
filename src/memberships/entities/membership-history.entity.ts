import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

@Entity('MEMBERSHIPS_MEMBERSHIP_HISTORY')
export class MembershipHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  membership_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  from_status?: string;

  @Column({ type: 'varchar', length: 50 })
  to_status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  transition?: string;

  /**
   * Idempotency slot for transitions that need one. Extend writes
   * `reference_type = 'extend'` and `reference_id = idempotency_key`; the
   * partial unique index `UQ_membership_history_extend_key` constrains only
   * that type, so every other history row keeps its existing multiplicity.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  reference_type?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference_id?: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'uuid', nullable: true })
  changed_by?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  occurred_at!: Date;
}