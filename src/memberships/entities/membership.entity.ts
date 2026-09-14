import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('MEMBERSHIPS_MEMBERSHIPS')
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  member_id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  plan_id?: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id?: string;

  @Column({ type: 'varchar', length: 50, default: 'active' })
  status!: string;

  @Column({ type: 'date', default: () => 'CURRENT_DATE' })
  start_date!: string;

  @Column({ type: 'date', nullable: true })
  end_date?: string;

  @Column({ type: 'date', nullable: true })
  renewal_date?: string;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at?: Date;

  @Column({ type: 'text', nullable: true })
  cancellation_reason?: string;

  @Column({ type: 'timestamptz', nullable: true })
  paused_at?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  pause_end_at?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  frozen_at?: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price_at_signup?: string;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency_at_signup?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}