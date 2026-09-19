import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Refund.
 *
 * Implements P6-21's resolution (A) as recorded in
 * docs/phase6-scoping-plan.md §6.2 (:469-475). The report catalog's
 * "Refund Report" row declares `Source = Refund` with Key Columns
 * `refund_date, amount, reason`, and §3.1.1/§10 require every declared column to
 * exist on the declared source, so this entity must carry all three under those
 * exact names plus `organization_id` (the column the executor's tenant scoping
 * filters on).
 *
 * **The column set is the catalog-row minimum, not a refund lifecycle.** §6.2
 * (:471) assigns everything else to P3-02, so this entity deliberately has no
 * `invoice_id` / `payment_id` link, no refund `status`, and no `currency` — each
 * of those would be inventing a design the plan left open. When P3-02 adds the
 * lifecycle columns they extend this table rather than replace it. `refund_date`
 * has no database DEFAULT for the same reason: §6.2 treats it as the refund's
 * own event time, written by the caller, not as a row-creation stamp (compare
 * `created_at`).
 *
 * FK behavior follows the finance domain, not §3.1's report tables:
 * FINANCE_INVOICES and FINANCE_PAYMENTS both declare ON DELETE NO ACTION for
 * their organization FK, so this table does too. `organization_id` is NOT
 * denormalised into a nullable column and there is no branch_id: the catalog row
 * does not ask for one, and §1.2's Finance row lists `branch_id` for the
 * module's other entities rather than for refunds specifically.
 *
 * `reason` is `text` and nullable. §6.2 names the column but does not constrain
 * it; the closest sibling (`LoyaltyTransaction.description`, nullable text) and
 * the finance domain's optional human-readable fields are all nullable, so no
 * NOT NULL is imposed on a value the plan never said was required.
 *
 * Not yet registered in `FinanceModule`'s `TypeOrmModule.forFeature([...])`:
 * entity metadata is discovered through the DataSource glob, and repository
 * injection belongs to whichever P3-02 service first reads this table. Adding it
 * to the module now would register a repository nothing consumes.
 */
@Entity('FINANCE_REFUNDS')
@Index(['organization_id', 'refund_date'])
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  /** The refund's own event time (§6.2's `refund_date`), not a row stamp. */
  @Column({ type: 'timestamptz' })
  refund_date!: Date;

  /** NUMERIC(15,2), matching FINANCE_INVOICES/FINANCE_PAYMENTS amounts. */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}