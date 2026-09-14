import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Raw attendance event.
 *
 * Columns follow `docs/database-plan.md` (ERD `ATTENDANCE_ATTENDANCE_EVENTS`):
 *   id, organization_id, branch_id, device_id, member_id, event_time, event_type,
 *   biometric_id
 *
 * This is the row that `ATTENDANCE_ACCESS_DECISIONS.attendance_event_id`
 * references, and whose id is published as `eventId` in the
 * `AttendanceEventRecorded.v1` payload (docs/event-contracts.md §Attendance
 * Events).
 *
 * `device_id` and `biometric_id` are nullable because Phase 1 records
 * front-desk (manual) events only: no turnstile and no biometric reader are
 * involved, so both identifiers are genuinely absent. The Phase 2 edge-sync
 * endpoint will populate them without a schema change.
 */
@Entity('ATTENDANCE_ATTENDANCE_EVENTS')
@Index(['member_id', 'event_time'])
@Index(['organization_id', 'event_time'])
export class AttendanceEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  organization_id!: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id?: string | null;

  /** Turnstile/reader that produced the event; null for a manual check-in. */
  @Column({ type: 'uuid', nullable: true })
  device_id?: string | null;

  @Column({ type: 'uuid' })
  @Index()
  member_id!: string;

  @Column({ type: 'timestamptz' })
  event_time!: Date;

  /** CHECK_IN | CHECK_OUT (see ATTENDANCE_EVENT_KINDS). */
  @Column({ type: 'varchar', length: 50 })
  event_type!: string;

  /** Hashed/tokenized biometric identifier; null for a manual check-in. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  biometric_id?: string | null;
}
