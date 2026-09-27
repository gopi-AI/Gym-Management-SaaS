import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('INVENTORY_PURCHASE_ORDERS')
@Index(['organization_id', 'branch_id', 'status'])
export class InventoryPurchaseOrder {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ type: 'uuid' }) @Index() branch_id!: string;
  @Column({ type: 'uuid' }) supplier_id!: string;
  @Column({ type: 'timestamptz' }) order_date!: Date;
  @Column({ type: 'timestamptz', nullable: true }) expected_delivery?: Date | null;
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 }) total_amount!: string;
  @Column({ length: 30, default: 'open' }) status!: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
}