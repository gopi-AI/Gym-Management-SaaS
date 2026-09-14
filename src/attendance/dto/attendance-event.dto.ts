import { IsOptional, IsUUID } from 'class-validator';

/**
 * Front-desk attendance event (`POST /v1/attendance/events` for a check-in and
 * `POST /v1/attendance/check-out` for a check-out — see `AttendanceController`).
 *
 * `event_time`, `device_id` and `biometric_id` are intentionally NOT accepted
 * from the client: the timestamp is generated server-side at the moment of the
 * event. `docs/task-backlog.md` (P1-05) lists "attendance fraud" as a risk, so a
 * staff client must not be able to post an arbitrary time; the global
 * `ValidationPipe` runs with `whitelist: true`, so any unexpected property
 * (including a client-supplied timestamp) is stripped before it reaches this
 * DTO. Device-driven events with their own device timestamps arrive with the
 * Phase 2 hardware sync, behind device authentication.
 */
export class AttendanceEventDto {
  @IsUUID()
  member_id!: string;

  @IsUUID()
  @IsOptional()
  branch_id?: string;
}
