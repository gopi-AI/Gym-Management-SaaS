import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
@Entity('CRM_LEADS')
@Index(['organization_id', 'branch_id', 'status'])
export class Lead {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ type: 'uuid' }) @Index() branch_id!: string;
  @Column({ type: 'uuid', nullable: true }) source_id?: string | null;
  @Column({ type: 'uuid', nullable: true }) stage_id?: string | null;
  @Column({ length: 255 }) first_name!: string;
  @Column({ length: 255 }) last_name!: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) phone?: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) email?: string | null;
  @Column({ length: 50, default: 'new' }) status!: string;
  @Column({ type: 'uuid', nullable: true }) member_id?: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
}