/**
 * `PTSession.status` lifecycle (Phase 2, §1).
 *
 * `scheduled` → `completed` is the only transition this task implements; it is
 * the transition that drives `PTEnrollment.sessions_used` (§12 Q1). Completing a
 * session does **not** create an attendance record (§12 Q3).
 *
 * `cancelled` and `no_show` are part of the specified value set but no Phase 2
 * code path writes them — `PTSessionCancelled.v1` is declared in §1 for the
 * Phase 3 rescheduling/cancellation flow.
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
