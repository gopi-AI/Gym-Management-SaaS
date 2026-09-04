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
  freezeEndDate: string;
  actualEndDate: string;
  daysRemaining: number;
}

// Event types
export type MembershipStartedEvent = EventEnvelope<MembershipStartedPayload>;
export type MembershipRenewedEvent = EventEnvelope<MembershipRenewedPayload>;
export type MembershipPausedEvent = EventEnvelope<MembershipPausedPayload>;
export type MembershipResumedEvent = EventEnvelope<MembershipResumedPayload>;
export type MembershipCancelledEvent = EventEnvelope<MembershipCancelledPayload>;
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
  MEMBERSHIP_TRANSFERRED: 'MembershipTransferred',
  MEMBERSHIP_FREEZE_STARTED: 'MembershipFreezeStarted',
  MEMBERSHIP_FREEZE_ENDED: 'MembershipFreezeEnded',
} as const;

// Event version constants
export const EVENT_VERSIONS = {
  V1: 'v1',
} as const;