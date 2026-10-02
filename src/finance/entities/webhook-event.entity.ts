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
  status!: 'received' | 'processing' | 'processed' | 'failed' | 'dead_lettered';

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  /** Retry counter, bounded by `WebhookEventProcessor.MAX_ATTEMPTS` (DEF-05). */
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  /** Lease marker: set on claim, cleared on success or failure (DEF-05). */
  @Column({ type: 'timestamptz', nullable: true })
  locked_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at?: Date | null;
}