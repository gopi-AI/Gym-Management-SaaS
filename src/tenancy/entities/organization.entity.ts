import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('TENANCY_ORGANIZATIONS')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  name!: string;

  @Column({ type: 'varchar', length: 50 })
  timezone!: string;

  @Column({ type: 'varchar', length: 50 })
  locale!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  /** Loyalty points expiry period in days (default 365). See §12 Q18. */
  @Column({ type: 'int', default: 365 })
  points_expiry_days!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'boolean', default: true })
  @Index()
  is_active!: boolean;
}