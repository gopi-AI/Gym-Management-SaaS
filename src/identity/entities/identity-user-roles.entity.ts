import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { IdentityRole } from './identity-roles.entity';

@Entity('IDENTITY_USER_ROLES')
export class IdentityUserRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'uuid' })
  role_id!: string;

  @ManyToOne(() => IdentityRole, (role) => role.userRoles)
  @JoinColumn({ name: 'role_id' })
  role!: IdentityRole;
}