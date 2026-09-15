import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Trainer profile (`PT_TRAINERS`, §1).
 *
 * Fields follow the §1 entity table verbatim: id, organization_id, branch_id,
 * user_id (nullable), first_name, last_name, specialty, certification,
 * hire_date, is_active.
 *
 * (Same shape as `Member`/`User` in the existing modules: uuid PK, explicit
 * `organization_id`, `@Index()` on the tenant column, `timestamptz`
 * create/update columns and a boolean `is_active` soft-state flag.)
 *
 * `branch_id` is NOT NULL, matching `Member.branch_id`: a trainer belongs to a
 * branch of the organization, and PT sessions inherit the trainer's branch when
 * the caller does not pass one.
 *
 * `user_id` is nullable and optional — an internal trainer may have no login.
 * It is NOT validated against `IDENTITY_USERS` in Phase 2 (the identity module
 * exports no general user lookup for arbitrary ids, and adding one is out of
 * scope for this task).
 */
@Entity('PT_TRAINERS')
@Index(['organization_id', 'last_name'])
@Index(['organization_id', 'user_id'])
export class PersonalTrainer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid' })
  branch_id!: string;

  /** Optional login for this trainer (nullable per §1). */
  @Column({ type: 'uuid', nullable: true })
  user_id?: string | null;

  @Column({ type: 'varchar', length: 255 })
  first_name!: string;

  @Column({ type: 'varchar', length: 255 })
  last_name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  specialty?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  certification?: string | null;

  @Column({ type: 'date', nullable: true })
  hire_date?: string | null;

  @Column({ type: 'boolean', default: true })
  @Index()
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}