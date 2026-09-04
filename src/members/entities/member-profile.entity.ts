import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, UpdateDateColumn } from 'typeorm';
import { Member } from './member.entity';

@Entity('MEMBERS_MEMBER_PROFILES')
export class MemberProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  height?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  weight?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  body_fat?: string;

  @Column({ type: 'text', nullable: true })
  medical_conditions?: string;

  @Column({ type: 'text', nullable: true })
  allergies?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  emergency_contact_name?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  emergency_contact_phone?: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @ManyToOne(() => Member, (member) => member.profiles)
  member!: Member;
}