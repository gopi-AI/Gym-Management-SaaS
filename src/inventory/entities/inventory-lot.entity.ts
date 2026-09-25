import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('INVENTORY_LOTS')
@Index(['organization_id', 'inventory_item_id', 'received_at'])
export class InventoryLot {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) @Index() organization_id!: string;
  @Column({ type: 'uuid' }) @Index() inventory_item_id!: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) lot_number?: string | null;
  @Column({ type: 'timestamptz', nullable: true }) expiry_date?: Date | null;
  @Column({ type: 'decimal', precision: 15, scale: 4 }) quantity!: string;
  @Column({ type: 'decimal', precision: 15, scale: 4 }) unit_cost!: string;
  @Column({ type: 'timestamptz' }) received_at!: Date;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}