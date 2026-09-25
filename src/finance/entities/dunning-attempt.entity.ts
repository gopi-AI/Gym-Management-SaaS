import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Audit of dunning event/notification dispatch; payment retries remain on Payment. */
@Entity('FINANCE_DUNNING_ATTEMPTS')
@Index(['organization_id', 'invoice_id', 'attempt_number'], { unique: true })
@Index(['organization_id', 'invoice_id', 'event_type'])
export class DunningAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  invoice_id!: string;

  /** `internal` in this bounded implementation; channels are downstream work. */
  @Column({ type: 'varchar', length: 50 })
  channel!: string;

  @Column({ type: 'int' })
  attempt_number!: number;

  @Column({ type: 'varchar', length: 50 })
  event_type!: string;

  @Column({ type: 'timestamptz' })
  scheduled_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at?: Date | null;

  @Column({ type: 'varchar', length: 50 })
  outcome!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}