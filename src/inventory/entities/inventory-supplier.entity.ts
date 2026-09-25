import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('INVENTORY_SUPPLIERS')
@Index(['organization_id', 'name'])
export class InventorySupplier {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ length: 255 }) name!: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) contact_person?: string | null;
  @Column({ type: 'varchar', length: 50, nullable: true }) phone?: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) email?: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) address?: string | null;
  @Column({ default: true }) is_active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
}