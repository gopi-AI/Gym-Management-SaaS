import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('INVENTORY_PURCHASE_ORDER_ITEMS')
@Index(['po_id', 'inventory_item_id'], { unique: true })
export class InventoryPurchaseOrderItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() po_id!: string;
  @Column({ type: 'uuid' }) @Index() inventory_item_id!: string;
  @Column({ type: 'decimal', precision: 15, scale: 4 }) quantity_ordered!: string;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) quantity_received!: string;
  @Column({ type: 'decimal', precision: 15, scale: 2 }) unit_cost!: string;
}