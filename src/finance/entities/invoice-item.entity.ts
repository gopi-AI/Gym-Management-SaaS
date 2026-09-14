import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Invoice line item.
 *
 * Columns follow `docs/database-plan.md` (ERD `FINANCE_INVOICE_ITEMS`):
 *   id, invoice_id, description, quantity, unit_price, line_total, tax_code
 *
 * `organization_id` is the one approved addition to that spec: every tenant
 * table in this codebase carries `organization_id` so it can be filtered by the
 * authorized organization without joining through the invoice.
 *
 * `tax_code` is nullable and unused in this pass — tax handling is out of scope
 * (see the TODO in `src/finance/services/invoices.service.ts`).
 */
@Entity('FINANCE_INVOICE_ITEMS')
@Index(['invoice_id'])
@Index(['organization_id'])
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  invoice_id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 1 })
  quantity!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  unit_price!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  line_total!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  tax_code?: string | null;
}
