import { EventEnvelope } from './event-envelope';

/**
 * Membership domain events
 * Versioned to allow backward compatibility
 */

// Payload types
export interface MembershipStartedPayload {
  membershipId: string;
  memberId: string;
  planId: string;
  startDate: string;
  initialFee: string; // Decimal as string for precision
}

export interface MembershipRenewedPayload {
  membershipId: string;
  renewalDate: string;
  nextPaymentDate: string;
  renewalFee: string;
}

export interface MembershipPausedPayload {
  membershipId: string;
  pauseStartDate: string;
  pauseEndDate?: string;
  pauseFee: string;
}

export interface MembershipResumedPayload {
  membershipId: string;
  resumeDate: string;
  remainingDays: number;
}

export interface MembershipCancelledPayload {
  membershipId: string;
  cancellationDate: string;
  reason?: string;
}

/**
 * `MembershipExpired.v1`
 *
 * Emitted when a membership passes its end date and is transitioned to the
 * terminal `expired` state. Produced by the membership expiry checker worker
 * (see `src/shared/workers/membership-expiry.worker.ts`) and by an explicit
 * `expire` lifecycle transition.
 */
export interface MembershipExpiredPayload {
  membershipId: string;
  memberId: string;
  /** ISO-8601 timestamp at which the membership was transitioned to expired. */
  expiredAt: string;
  /** The membership end date that was reached (YYYY-MM-DD). */
  endDate?: string;
}

export interface MembershipTransferredPayload {
  membershipId: string;
  memberId: string;
  fromBranchId: string;
  toBranchId: string;
  transferDate: string;
}

export interface MembershipFreezeStartedPayload {
  membershipId: string;
  freezeStartDate: string;
  freezeEndDate?: string;
  freezeDurationDays: number;
}

export interface MembershipFreezeEndedPayload {
  membershipId: string;
  /** ISO-8601 timestamp at which the freeze ended (the unfreeze instant). */
  freezeEndDate: string;
  /** The membership's actual end date (YYYY-MM-DD), extended by frozen days. */
  actualEndDate: string;
  /** Calendar days remaining until the (possibly extended) end date. */
  daysRemaining: number;
}

// Event types
export type MembershipStartedEvent = EventEnvelope<MembershipStartedPayload>;
export type MembershipRenewedEvent = EventEnvelope<MembershipRenewedPayload>;
export type MembershipPausedEvent = EventEnvelope<MembershipPausedPayload>;
export type MembershipResumedEvent = EventEnvelope<MembershipResumedPayload>;
export type MembershipCancelledEvent = EventEnvelope<MembershipCancelledPayload>;
export type MembershipExpiredEvent = EventEnvelope<MembershipExpiredPayload>;
export type MembershipTransferredEvent = EventEnvelope<MembershipTransferredPayload>;
export type MembershipFreezeStartedEvent = EventEnvelope<MembershipFreezeStartedPayload>;
export type MembershipFreezeEndedEvent = EventEnvelope<MembershipFreezeEndedPayload>;

// Union type for all membership events
export type MembershipEvent =
  | MembershipStartedEvent
  | MembershipRenewedEvent
  | MembershipPausedEvent
  | MembershipResumedEvent
  | MembershipCancelledEvent
  | MembershipExpiredEvent
  | MembershipTransferredEvent
  | MembershipFreezeStartedEvent
  | MembershipFreezeEndedEvent;

// Event type constants
export const EVENT_TYPES = {
  MEMBERSHIP_STARTED: 'MembershipStarted',
  MEMBERSHIP_RENEWED: 'MembershipRenewed',
  MEMBERSHIP_PAUSED: 'MembershipPaused',
  MEMBERSHIP_RESUMED: 'MembershipResumed',
  MEMBERSHIP_CANCELLED: 'MembershipCancelled',
  MEMBERSHIP_EXPIRED: 'MembershipExpired',
  MEMBERSHIP_TRANSFERRED: 'MembershipTransferred',
  MEMBERSHIP_FREEZE_STARTED: 'MembershipFreezeStarted',
  MEMBERSHIP_FREEZE_ENDED: 'MembershipFreezeEnded',
} as const;

// Event version constants
export const EVENT_VERSIONS = {
  V1: 'v1',
} as const;