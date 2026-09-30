/**
 * `PTSession.status` lifecycle (Phase 2, §1).
 *
 * `scheduled` → `completed` is the only transition this task implements; it is
 * the transition that drives `PTEnrollment.sessions_used` (§12 Q1). Completing a
 * session does **not** create an attendance record (§12 Q3).
 *
 * `cancelled` and `no_show` are part of the specified value set but nothing in
 * the repository writes them: `PtSessionsService` exposes no cancel or
 * reschedule operation, the module registers no session route, and
 * `PTSessionCancelled.v1` — declared in §1 and mirrored in
 * `src/pt/pt.constants.ts` and `packages/contracts/src/events/pt.events.ts` —
 * has no publisher. The statuses and the event are declarations only, and no
 * flow defined anywhere in the repository publishes the event.
 */
export enum PTSessionStatus {
  SCHEDULED = 'scheduled',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export const PT_SESSION_STATUS_VALUES = [
  PTSessionStatus.SCHEDULED,
  PTSessionStatus.COMPLETED,
  PTSessionStatus.CANCELLED,
  PTSessionStatus.NO_SHOW,
] as const;
