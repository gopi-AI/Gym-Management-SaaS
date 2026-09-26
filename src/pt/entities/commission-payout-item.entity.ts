import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('PT_COMMISSION_PAYOUT_ITEMS')
@Index(['organization_id', 'trainer_commission_id'], { unique: true })
@Index(['organization_id', 'payout_run_id'])
export class CommissionPayoutItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  payout_run_id!: string;

  @Column({ type: 'uuid' })
  trainer_commission_id!: string;

  @Column({ type: 'uuid' })
  trainer_id!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  @Column({ type: 'timestamptz', nullable: true })
  paid_at?: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  paid_amount?: string | null;
}