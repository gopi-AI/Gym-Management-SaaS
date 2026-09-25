import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Report job — one row per report execution.
 *
 * Implements docs/phase6-scoping-plan.md §3.2 (entity metadata for the
 * `"REPORTS_REPORT_JOBS"` table created by
 * 1788965263401-CreateReportJobsTable.ts).
 *
 * `status` is the state machine of §3.2:
 *   pending | running | completed | failed | cancelled
 * `pending` and `running` are non-terminal; the other three are terminal, which
 * matters to the queue-depth guard below.
 *
 * Queue-depth guard (§3.2, :270-272): an organization SHOULD NOT hold more than
 * MAX_PENDING_JOBS outstanding `pending` jobs. That guard is enforced on the API
 * path with a **Redis counter keyed by organization_id**, released when a job
 * reaches a terminal state — so it is deliberately *not* a column here. The
 * table's contribution to it is `status` plus IDX_REPORTS_REPORT_JOBS_STATUS,
 * which is what the counter is reconciled against after a restart. This entity
 * adds no field for the guard because the plan specifies none.
 *
 * `result_*` columns describe the exported artefact: §8 uploads to S3 and the
 * download API (§8.3) serves a pre-signed URL from them. `result_format` is
 * 'json' | 'csv' | 'xlsx' (§8.1).
 *
 * IDX_REPORTS_REPORT_JOBS_CREATED_AT is declared `(created_at DESC)` in the
 * migration per §3.2. TypeORM's @Index() decorator cannot express a sort
 * direction, so this entity does NOT declare that index: the migration owns it,
 * and a future `migration:generate` will see it as unmanaged and propose
 * dropping it. That is a known, accepted consequence of following the plan's
 * DESC ordering — the alternative would be an ASC index here plus a divergence
 * from §3.2.
 *
 * `report_schema_id` is nullable and NO ACTION: §3.2 states no ON DELETE for it,
 * and by the sibling pattern a nullable optional reference is NO ACTION (e.g.
 * FINANCE_INVOICES.membership_id). The same applies to `created_by`. A job row
 * therefore survives independently, which suits an execution log.
 */
@Entity('REPORTS_REPORT_JOBS')
export class ReportJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  /** Nullable: a job may be executed without a stored schema (§3.2). */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  report_schema_id?: string | null;

  /** pending | running | completed | failed | cancelled */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  @Index()
  status!: string;

  /** The parameter values this execution was submitted with. */
  @Column({ type: 'jsonb', nullable: true })
  parameters?: unknown | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  result_s3_key?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  result_s3_bucket?: string | null;

  @Column({ type: 'int', nullable: true })
  result_rows?: number | null;

  /** 'json' | 'csv' | 'xlsx' (§8.1). */
  @Column({ type: 'varchar', length: 10, default: 'json', nullable: true })
  result_format?: string | null;

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  @Column({ type: 'int', default: 0, nullable: true })
  progress_pct?: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  created_by?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}