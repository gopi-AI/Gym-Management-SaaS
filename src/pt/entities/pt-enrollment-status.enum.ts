/**
 * `PTEnrollment.status` lifecycle (Phase 2, §1 / §12 Q1).
 *
 * - `active`    — the enrollment is live; PT sessions may be booked against it.
 * - `completed` — all purchased sessions have been consumed, so booking against
 *                 it is rejected (§12 Q1). Terminal for booking purposes.
 * - `cancelled` — reserved. **No code path sets this in Phase 2.** The value is
 *                 pre-deployed for the same reason as the 3-state commission
 *                 status: the Phase 3 cancellation/refund flow then needs no
 *                 schema migration. `pt:delete` ("Cancel enrollments") is not
 *                 implemented in this task.
 */
export enum PTEnrollmentStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export const PT_ENROLLMENT_STATUS_VALUES = [
  PTEnrollmentStatus.ACTIVE,
  PTEnrollmentStatus.COMPLETED,
  PTEnrollmentStatus.CANCELLED,
] as const;
