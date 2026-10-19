import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * Append-only history of branch settings overrides.
 *
 * Mirrors {@link MembershipHistory} shape: one row per {@link BranchSettingsService.update}
 * call (not per field), with a jsonb {@link changes} diff carrying `{ field: { from, to } }`
 * for every field actually touched. No `reason` column — settings changes carry no
 * required reason in the backlog criteria, so adding one would invent a field the
 * spec does not ask for.
 *
 * Intentionally NOT an outbox record: branch settings changes publish no event
 * today and nothing downstream consumes them (see `docs/event-contracts.md`), so
 * a relational audit table is the correct persistence shape.
 */
@Entity('TENANCY_BRANCH_SETTINGS_HISTORY')
export class BranchSettingsHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  branch_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  changed_by?: string | null;

  /**
   * jsonb diff of the fields actually changed by this PATCH.
   * Example: `{ "time_zone": { "from": null, "to": "America/New_York" } }`.
   * Only fields present in the incoming DTO AND with a different effective value
   * are recorded — identical-from/to pairs are never written (no-op skips).
   */
  @Column({ type: 'jsonb', nullable: true })
  changes?: Record<string, { from: unknown; to: unknown }> | null;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  occurred_at!: Date;
}
