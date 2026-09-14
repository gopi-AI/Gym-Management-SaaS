import { EventEnvelope } from './event-envelope';

/**
 * Attendance domain events.
 *
 * `AttendanceEventRecorded.v1` mirrors the payload documented in
 * `docs/event-contracts.md` (§Attendance Events):
 *
 *   { eventId, deviceId, memberId, eventTime, eventType, biometricId }
 *
 * The documented shape is device/biometric oriented. Manual front-desk
 * check-ins have no device and no biometric identifier, so `deviceId` and
 * `biometricId` are `null` for them, and the check-in is described with the
 * documented `eventType` value `CHECK_IN`.
 *
 * `checkInMethod` and `checkedInBy` are OPTIONAL additions to the v1 payload.
 * They are backward compatible under the evolution rules in
 * `docs/event-contracts.md` ("adding new optional fields to payload") and are
 * what allow a consumer to distinguish a manual front-desk check-in
 * (method `manual`, with a staff `checkedInBy` user id) from a device event.
 */

export interface AttendanceEventRecordedPayload {
  /**
   * The recorded attendance event id (`ATTENDANCE_ATTENDANCE_EVENTS.id`), i.e.
   * the raw event that `ATTENDANCE_ACCESS_DECISIONS` points at. The attendance
   * RECORD id (the check-in/check-out session) is a separate resource and is
   * available from the attendance API.
   */
  eventId: string;
  /** Device that produced the event; null for staff-initiated manual check-in. */
  deviceId: string | null;
  memberId: string;
  /** ISO-8601 timestamp of the check-in. */
  eventTime: string;
  /** Documented values include CHECK_IN / CHECK_OUT. */
  eventType: string;
  /** Hashed/tokenized biometric identifier; null for manual check-in. */
  biometricId: string | null;
  /**
   * Optional (backward-compatible): how a CHECK_IN was captured —
   * manual | device | biometric | api.
   */
  checkInMethod?: string;
  /**
   * Optional (backward-compatible): how a CHECK_OUT was captured. The mirror of
   * `checkInMethod` for the other event kind, so a consumer never has to read a
   * "check-in" method on a check-out event.
   */
  checkOutMethod?: string;
  /** Optional (backward-compatible): staff user id that performed a manual check-in. */
  checkedInBy?: string | null;
}

export type AttendanceEventRecordedEvent = EventEnvelope<AttendanceEventRecordedPayload>;

export type AttendanceEvent = AttendanceEventRecordedEvent;

export const ATTENDANCE_EVENT_TYPES = {
  ATTENDANCE_EVENT_RECORDED: 'AttendanceEventRecorded',
} as const;

/**
 * Documented `eventType` values carried inside the payload.
 */
export const ATTENDANCE_PERMISSIONS = {
  READ: { resource: 'attendance', action: 'read' },
  CHECK_IN: { resource: 'attendance', action: 'check-in' },
  CHECK_OUT: { resource: 'attendance', action: 'check-out' },
} as const;

export const ATTENDANCE_EVENT_KINDS = {
  CHECK_IN: 'CHECK_IN',
  CHECK_OUT: 'CHECK_OUT',
} as const;

export const ATTENDANCE_CHECK_IN_METHODS = {
  MANUAL: 'manual',
} as const;

export const ATTENDANCE_CHECK_OUT_METHODS = {
  MANUAL: 'manual',
} as const;

export const ATTENDANCE_EVENT_VERSION = 'v1';

/** Eligibility outcomes returned when validating a member at check-in time. */
export const CHECK_IN_ELIGIBILITY_REASONS = {
  NO_MEMBERSHIP: 'no_membership',
  NOT_STARTED: 'not_started',
  ENDED: 'ended',
  PAUSED: 'paused',
  FROZEN: 'frozen',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;
