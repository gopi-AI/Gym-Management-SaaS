import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('INVENTORY_TRANSACTIONS')
@Index(['organization_id', 'branch_id', 'inventory_item_id', 'transaction_date'])
export class InventoryTransaction {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ type: 'uuid' }) @Index() branch_id!: string;
  @Column({ type: 'uuid' }) @Index() inventory_item_id!: string;
  @Column({ length: 30 }) transaction_type!: string;
  @Column({ type: 'decimal', precision: 15, scale: 4 }) quantity!: string;
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true }) unit_cost?: string | null;
  @Column({ type: 'uuid', nullable: true }) reference_id?: string | null;
  @Column({ type: 'varchar', length: 50, nullable: true }) reference_type?: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) notes?: string | null;
  @Column({ type: 'timestamptz' }) transaction_date!: Date;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}