import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity('CRM_LEAD_STAGES')
@Index(['organization_id', 'sort_order'])
export class LeadStage { @PrimaryGeneratedColumn('uuid') id!: string; @Column({ type: 'uuid' }) @Index() organization_id!: string; @Column({ length: 100 }) name!: string; @Column({ length: 50 }) key!: string; @Column({ type: 'text', nullable: true }) description?: string | null; @Column({ type: 'int' }) sort_order!: number; @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date; }