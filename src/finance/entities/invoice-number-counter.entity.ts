import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Per-organization invoice number sequence.
 *
 * The approved invoice-number scheme is a per-organization sequential number
 * with a UNIQUE index on (organization_id, invoice_number). A sequence that is
 * safe under concurrency requires a locked counter row, which is exactly the
 * pattern already used by `MEMBERS_LOCAL_ID_COUNTERS` /
 * `src/members/services/local-id.service.ts` — this table is the finance
 * equivalent rather than a second, incompatible mechanism.
 */
@Entity('FINANCE_INVOICE_NUMBER_COUNTERS')
@Index(['organization_id'], { unique: true })
export class InvoiceNumberCounter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organization_id!: string;

  /** Highest invoice sequence already issued for the organization. */
  @Column({ type: 'int', default: 0 })
  last_invoice_number!: number;
}
