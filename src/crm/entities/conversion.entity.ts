import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity('CRM_CONVERSIONS')
@Index(['organization_id', 'lead_id'], { unique: true })
export class Conversion { @PrimaryGeneratedColumn('uuid') id!: string; @Column({ type: 'uuid' }) organization_id!: string; @Column({ type: 'uuid' }) lead_id!: string; @Column({ type: 'uuid' }) member_id!: string; @Column({ type: 'uuid', nullable: true }) membership_id?: string | null; @CreateDateColumn({ type: 'timestamptz' }) conversion_date!: Date; }