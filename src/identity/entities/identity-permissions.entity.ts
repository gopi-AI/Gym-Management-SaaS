import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { IdentityRolePermission } from './identity-role-permissions.entity';

@Entity('IDENTITY_PERMISSIONS')
export class IdentityPermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  description!: string;

  @Column({ type: 'varchar', length: 50 })
  resource!: string;

  @Column({ type: 'varchar', length: 50 })
  action!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @OneToMany(() => IdentityRolePermission, (rolePermission) => rolePermission.permission)
  rolePermissions!: IdentityRolePermission[];
}