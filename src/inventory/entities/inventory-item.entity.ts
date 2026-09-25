import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('INVENTORY_ITEMS')
@Index(['organization_id', 'branch_id', 'sku'], { unique: true })
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ type: 'uuid' }) @Index() branch_id!: string;
  @Column({ length: 255 }) name!: string;
  @Column({ length: 100 }) sku!: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) barcode?: string | null;
  @Column({ length: 50, default: 'unit' }) unit!: string;
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true }) selling_price?: string | null;
  @Column({ default: true }) is_active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
}