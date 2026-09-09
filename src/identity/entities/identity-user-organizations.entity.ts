import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { IdentityUser } from './identity-users.entity';
import { IdentityRole } from './identity-roles.entity';
import { Organization } from '../../tenancy/entities/organization.entity';

/**
 * Authoritative membership linking a user to one or more organizations.
 *
 * This is the relation Correction #10 (tenant-context enforcement) will rely
 * on: an authenticated user's authorized organizations are defined here in the
 * database, NOT by client-supplied organization IDs or headers.
 *
 * A user may belong to multiple organizations. For each membership an optional
 * organization-level role can be assigned, reusing the existing IdentityRole
 * table (and thereby the existing role → permission authorization chain).
 */
@Entity('IDENTITY_USER_ORGANIZATIONS')
@Unique(['user_id', 'organization_id'])
@Index(['organization_id'])
@Index(['user_id'])
export class IdentityUserOrganization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => IdentityUser)
  @JoinColumn({ name: 'user_id' })
  user!: IdentityUser;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  /** Optional organization-level role; reuses the existing IdentityRole table. */
  @Column({ type: 'uuid', nullable: true })
  role_id!: string | null;

  @ManyToOne(() => IdentityRole, (role) => role.userRoles)
  @JoinColumn({ name: 'role_id' })
  role!: IdentityRole | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;
}