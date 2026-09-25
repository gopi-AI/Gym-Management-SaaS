import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('FINANCE_PAYMENT_METHODS')
@Index(['organization_id', 'member_id', 'stripe_payment_method_id'], { unique: true })
@Index(['organization_id', 'member_id', 'is_default'])
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'varchar', length: 255 })
  stripe_customer_id!: string;

  @Column({ type: 'varchar', length: 255 })
  stripe_payment_method_id!: string;

  @Column({ type: 'boolean', default: false })
  is_default!: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  card_brand?: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  card_last4?: string | null;
}