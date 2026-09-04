import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { IdentityUserRole } from './identity-user-roles.entity';
import { IdentityRolePermission } from './identity-role-permissions.entity';

@Entity('IDENTITY_ROLES')
export class IdentityRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  description!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @OneToMany(() => IdentityUserRole, (userRole) => userRole.role)
  userRoles!: IdentityUserRole[];

  @OneToMany(() => IdentityRolePermission, (rolePermission) => rolePermission.role)
  rolePermissions!: IdentityRolePermission[];
}