import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** Immutable record of the membership discount applied to an invoice. */
@Entity('FINANCE_INVOICE_DISCOUNTS')
@Index(['invoice_id'])
@Index(['organization_id'])
export class InvoiceDiscount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  invoice_id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  membership_discount_id!: string;

  @Column({ type: 'varchar', length: 20 })
  discount_type!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  applied_amount!: string;
}