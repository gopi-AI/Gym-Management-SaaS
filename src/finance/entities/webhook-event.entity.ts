import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('FINANCE_WEBHOOK_EVENTS')
@Index(['provider_event_id'], { unique: true })
@Index(['status', 'created_at'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  provider!: string;

  @Column({ type: 'varchar', length: 255 })
  provider_event_id!: string;

  @Column({ type: 'varchar', length: 150 })
  event_type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string | null;

  @Column({ type: 'varchar', length: 20, default: 'received' })
  status!: 'received' | 'processing' | 'processed' | 'failed';

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at?: Date | null;
}