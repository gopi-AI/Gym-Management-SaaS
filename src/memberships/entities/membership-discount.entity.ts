import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('MEMBERSHIP_MEMBERSHIP_DISCOUNTS')
@Index(['membership_id'])
@Index(['organization_id'])
export class MembershipDiscount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  membership_id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 20 })
  discount_type!: 'fixed' | 'percentage';

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Column({ type: 'timestamptz' })
  starts_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  ends_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}