import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { IdentityRole } from './identity-roles.entity';
import { IdentityPermission } from './identity-permissions.entity';

@Entity('IDENTITY_ROLE_PERMISSIONS')
export class IdentityRolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  role_id!: string;

  @Column({ type: 'uuid' })
  permission_id!: string;

  @ManyToOne(() => IdentityRole, (role) => role.rolePermissions)
  @JoinColumn({ name: 'role_id' })
  role!: IdentityRole;

  @ManyToOne(() => IdentityPermission, (permission) => permission.rolePermissions)
  @JoinColumn({ name: 'permission_id' })
  permission!: IdentityPermission;
}