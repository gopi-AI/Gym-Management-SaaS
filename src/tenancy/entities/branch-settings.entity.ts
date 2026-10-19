import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Branch-level overrides for org-level {@link TenantSettings}.
 *
 * Every column is nullable. `null` means "not overridden → inherit from the
 * organization's TenantSettings". This keeps the merge rule one direction:
 * branch wins, else org, else null (display/context fallback).
 */
@Entity('TENANCY_BRANCH_SETTINGS')
export class BranchSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  branch_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  time_zone?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  locale?: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
