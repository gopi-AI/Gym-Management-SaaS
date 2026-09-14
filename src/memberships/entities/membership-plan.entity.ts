import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('MEMBERSHIPS_MEMBERSHIP_PLANS')
export class MembershipPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 50 })
  billing_period!: string;

  @Column({ type: 'int' })
  duration_days!: number;

  @Column({ type: 'int', default: 0 })
  trial_days!: number;

  @Column({ type: 'boolean', default: true })
  @Index()
  is_active!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  benefits?: Record<string, unknown>[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at?: Date;
}