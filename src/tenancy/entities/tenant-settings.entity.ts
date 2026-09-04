import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('TENANCY_TENANT_SETTINGS')
export class TenantSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 100 })
  time_zone!: string;

  @Column({ type: 'varchar', length: 50 })
  locale!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;
}

