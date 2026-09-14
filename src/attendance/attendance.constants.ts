/**
 * Attendance domain constants.
 *
 * Mirrors packages/contracts/src/events/attendance.events.ts, which mirrors
 * `docs/event-contracts.md` (§Attendance Events) and `docs/api-plan.md`
 * (§Attendance). The backend deliberately does not import the contracts package
 * at build time (rootDir is ./src), so the names are mirrored here and MUST stay
 * in lockstep.
 */

/** Current event version for attendance events. Mirrors EVENT_VERSIONS.V1. */
export const ATTENDANCE_EVENT_VERSION = 'v1';

export const ATTENDANCE_EVENT_TYPES = {
  ATTENDANCE_EVENT_RECORDED: 'AttendanceEventRecorded',
} as const;

/** Documented `eventType` values carried inside the payload. */
export const ATTENDANCE_EVENT_KINDS = {
  CHECK_IN: 'CHECK_IN',
  CHECK_OUT: 'CHECK_OUT',
} as const;

export type AttendanceEventKind =
  (typeof ATTENDANCE_EVENT_KINDS)[keyof typeof ATTENDANCE_EVENT_KINDS];

export const ATTENDANCE_EVENT_KIND_VALUES: string[] = Object.values(ATTENDANCE_EVENT_KINDS);

/**
 * How a check-in/out was captured. Phase 1 captures front-desk check-ins only,
 * so `manual` is the sole value; device/biometric capture arrives with the Phase
 * 2 hardware integration and will add `device` / `biometric` / `api` here.
 */
export const ATTENDANCE_METHODS = {
  MANUAL: 'manual',
} as const;

/**
 * Reasons a member can be refused entry. Mirrors the eligibility reasons owned by
 * the memberships module (`evaluateCheckInEligibility`) plus the two
 * attendance-only state conflicts.
 */
export const CHECK_IN_ELIGIBILITY_REASONS = {
  NO_MEMBERSHIP: 'no_membership',
  NOT_STARTED: 'not_started',
  ENDED: 'ended',
  PAUSED: 'paused',
  FROZEN: 'frozen',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;

/** Attendance state conflicts (not membership eligibility problems). */
export const ATTENDANCE_DECISION_REASONS = {
  ALREADY_CHECKED_IN: 'already_checked_in',
  NO_OPEN_CHECK_IN: 'no_open_check_in',
} as const;

/**
 * Message returned to the front desk for each denial reason. Keyed by reason so
 * the API can never return an unexplained refusal.
 */
export const ATTENDANCE_DENIAL_MESSAGES: Record<string, string> = {
  [CHECK_IN_ELIGIBILITY_REASONS.NO_MEMBERSHIP]: 'Member has no membership',
  [CHECK_IN_ELIGIBILITY_REASONS.NOT_STARTED]: 'Membership has not started yet',
  [CHECK_IN_ELIGIBILITY_REASONS.ENDED]: 'Membership has ended',
  [CHECK_IN_ELIGIBILITY_REASONS.PAUSED]: 'Membership is paused',
  [CHECK_IN_ELIGIBILITY_REASONS.FROZEN]: 'Membership is frozen',
  [CHECK_IN_ELIGIBILITY_REASONS.CANCELLED]: 'Membership is cancelled',
  [CHECK_IN_ELIGIBILITY_REASONS.EXPIRED]: 'Membership has expired',
  [ATTENDANCE_DECISION_REASONS.ALREADY_CHECKED_IN]: 'Member is already checked in',
  [ATTENDANCE_DECISION_REASONS.NO_OPEN_CHECK_IN]: 'Member is not checked in',
};

/** Human-readable message for a denial reason, falling back to the reason code. */
export function attendanceDenialMessage(reason: string): string {
  return ATTENDANCE_DENIAL_MESSAGES[reason] ?? `Check-in denied (${reason})`;
}
