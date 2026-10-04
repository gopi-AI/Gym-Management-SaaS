import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * Materialized-view registry — one row per registered materialized view.
 *
 * Implements docs/phase6-scoping-plan.md §3.3 (entity metadata for the
 * `"REPORTS_MATERIALIZED_VIEWS"` table created by
 * 1788965263402-CreateMaterializedViewsTable.ts).
 *
 * This table did not exist before Phase 6: the name appeared in
 * docs/database-plan.md only as a Mermaid ERD node, with no SQL and no
 * migration. §3.3 (:276, :289) adopts it as the registry that §4.3's endpoints
 * and §7.4's refresh flow operate against, which is why Phase 6 creates it. The
 * entity name for the table — `"REPORTS_MATERIALIZED_VIEWS"` — is the exact
 * quoted form §3.3 requires.
 *
 * **Not tenant-scoped, deliberately**: §3.3 (:287) is explicit that this is a
 * platform-level registry of view *definitions*, so there is no
 * `organization_id`. Tenant isolation is enforced by each materialized view's
 * own `organization_id` grouping, not by this table.
 *
 * `name` must equal the view's SQL identifier exactly (§7.4) — §7.4's
 * registration step INSERTs one row per view using the physical name. There is
 * no unique constraint on it, because §3.3 specifies none; the requirement is a
 * convention the registration step must honour rather than a database rule.
 *
 * `last_refreshed` is stamped by the refresh worker after a successful
 * `REFRESH MATERIALIZED VIEW` (§7.4). NULL means "never refreshed".
 *
 * `REPORTS_MATERIALIZED_VIEWS` has no FK and no `updated_at`: §3.3's shape is
 * `id, name, description, last_refreshed` and nothing else was added.
 */
@Entity('REPORTS_MATERIALIZED_VIEWS')
export class MaterializedView {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Must equal the materialized view's SQL identifier exactly (§7.4). */
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Stamped by the refresh worker (§7.4). NULL = never refreshed. */
  @Column({ type: 'timestamptz', nullable: true })
  last_refreshed?: Date | null;
}