import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Sellable PT session package (`PT_PACKAGES`, §1 / §12 Q4).
 *
 * **Price is tax-exclusive (net).** Tax handling is Phase 3 finance scope, so
 * this entity deliberately carries NO tax fields and no tax logic.
 *
 * `currency` is stored explicitly on the row (never inferred at read time). The
 * service defaults it to the organization's currency at creation time (§12 Q4)
 * and persists whatever value was used, so a later change to the organization's
 * currency cannot retroactively re-denominate existing packages — the same
 * snapshot convention as `Membership.price_at_signup`/`currency_at_signup`.
 *
 * `commission_percent` is the package-level default trainer commission used by
 * `TrainerCommission` at enrollment time (§12 Q2). It is nullable: a package may
 * be configured without a commission, in which case an enrollment against it
 * only produces a non-zero commission if the enrollment overrides the percent.
 */
@Entity('PT_PACKAGES')
@Index(['organization_id', 'name'])
export class PTPackage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Number of PT sessions included in the package. Snapshotted onto the enrollment. */
  @Column({ type: 'int' })
  session_count!: number;

  /** Pre-tax (net) price, persisted as NUMERIC(10,2) and read back as a string. */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: string;

  /** ISO-4217 code, stored explicitly (defaults to the org currency at creation). */
  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  /** Package-level default trainer commission percentage (nullable). */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commission_percent?: string | null;

  @Column({ type: 'date', nullable: true })
  valid_from?: string | null;

  @Column({ type: 'date', nullable: true })
  valid_to?: string | null;

  @Column({ type: 'boolean', default: true })
  @Index()
  is_active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}