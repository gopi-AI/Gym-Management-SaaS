/**
 * `PTEnrollment.status` lifecycle (Phase 2, §1 / §12 Q1).
 *
 * - `active`    — the enrollment is live; PT sessions may be booked against it.
 * - `completed` — all purchased sessions have been consumed, so booking against
 *                 it is rejected (§12 Q1). Terminal for booking purposes.
 * - `cancelled` — terminal for scheduling/commission purposes. P3-11 sets it
 *                 through the PT-owned enrollment cancellation transaction;
 *                 it was pre-deployed, so this needs no schema migration.
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
