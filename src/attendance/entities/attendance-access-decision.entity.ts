import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Access decision: the authorization outcome of one attendance event.
 *
 * Columns follow `docs/database-plan.md` (ERD `ATTENDANCE_ACCESS_DECISIONS`):
 *   id, attendance_event_id, is_granted, reason, decided_at
 *
 * Denied attempts are persisted too — that audit trail ("who was turned away and
 * why") is the point of this table, so a denial is recorded and then reported to
 * the caller rather than rolled back with the request.
 *
 * The ERD gives this table no `organization_id`; tenancy is therefore enforced
 * by joining `ATTENDANCE_ATTENDANCE_EVENTS` (which owns `organization_id`) — see
 * `AttendanceService.findAccessDecisions`. `decided_at` is populated
 * automatically, so the ERD's column is never left for the caller to forge.
 */
@Entity('ATTENDANCE_ACCESS_DECISIONS')
@Index(['attendance_event_id'])
@Index(['is_granted', 'decided_at'])
export class AttendanceAccessDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  attendance_event_id!: string;

  @Column({ type: 'boolean' })
  is_granted!: boolean;

  /** Denial reason (see ATTENDANCE_DENIAL_MESSAGES); null when granted. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  reason?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  decided_at!: Date;
}
