import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { QueryDefinition } from '../types/query-definition';

/**
 * Report schema — one row per report definition, per organization.
 *
 * Implements docs/phase6-scoping-plan.md §3.1 (entity metadata for the
 * `"REPORTS_REPORT_SCHEMAS"` table created by
 * 1788965263253-CreateReportSchemasTable.ts).
 *
 * `query_definition` holds the structured JSON of §3.1.1 — NOT raw SQL. The
 * executor compiles it, validates every column against entity metadata and
 * applies tenant scoping, which is only possible because the definition is
 * data rather than a SQL string.
 *
 * `category` is one of: 'member' | 'finance' | 'attendance' | 'workout' |
 * 'diet' | 'pt' | 'loyalty' | 'ai-usage' | 'custom' (§3.1). It is a plain
 * varchar with a DEFAULT rather than a DB enum, exactly as the plan specifies —
 * no CHECK constraint is added, so an unknown value is not rejected by the
 * database.
 *
 * `is_system` marks the seeded catalog rows of §6: they are created by P6-07
 * and cannot be deleted by users (§6 preamble). `created_by` is nullable
 * because a system row has no author.
 *
 * FK behavior: the organization FK is ON DELETE CASCADE, as §3.1 states. Note
 * that the sibling finance and AI tables use ON DELETE NO ACTION for their
 * organization FKs, so this table follows the plan's explicit choice rather
 * than the surrounding convention — recorded here so the divergence is visible
 * rather than discovered later.
 */
@Entity('REPORTS_REPORT_SCHEMAS')
export class ReportSchema {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** 'member' | 'finance' | 'attendance' | 'workout' | 'diet' | 'pt' | 'loyalty' | 'ai-usage' | 'custom' */
  @Column({ type: 'varchar', length: 50, default: 'custom' })
  @Index()
  category!: string;

  /** Structured query definition (§3.1.1). Never raw SQL. */
  @Column({ type: 'jsonb', default: {} })
  query_definition!: QueryDefinition;

  /**
   * Declared parameter list for this schema. The plan does not define an
   * element shape for it (§3.1.1 documents only the `$name` placeholder
   * convention for filter values), so the element type is left as `unknown`
   * rather than invented here.
   */
  @Column({ type: 'jsonb', default: [] })
  parameters!: unknown[];

  /** System rows are seeded (§6) and cannot be deleted by users. */
  @Column({ type: 'boolean', default: false })
  is_system!: boolean;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  /** Null for system-seeded rows; set for user-created schemas. */
  @Column({ type: 'uuid', nullable: true })
  created_by?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}