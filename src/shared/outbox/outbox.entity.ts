import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('shared.outbox')
export class OutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'text' })
  payload!: string;

  @Column({ type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ type: 'boolean', default: false })
  processed!: boolean;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamp', nullable: true })
  lockedAt!: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lockedBy!: string | null;

  @Column({ type: 'boolean', default: false })
  deadLettered!: boolean;
}