import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity('CRM_LEAD_SOURCES')
@Index(['organization_id', 'name'], { unique: true })
export class LeadSource { @PrimaryGeneratedColumn('uuid') id!: string; @Column({ type: 'uuid' }) @Index() organization_id!: string; @Column({ length: 100 }) name!: string; @Column({ type: 'text', nullable: true }) description?: string | null; @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date; }