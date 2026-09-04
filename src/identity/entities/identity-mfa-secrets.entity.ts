import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('IDENTITY_MFA_SECRETS')
export class IdentityMfaSecret {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'varchar', length: 255 })
  secret!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}