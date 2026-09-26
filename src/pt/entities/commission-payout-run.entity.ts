import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('PT_COMMISSION_PAYOUT_RUNS')
@Index(['organization_id', 'created_at'])
export class CommissionPayoutRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'date' })
  period_start!: string;

  @Column({ type: 'date' })
  period_end!: string;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: '0.00' })
  total_amount!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'uuid', nullable: true })
  created_by?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}