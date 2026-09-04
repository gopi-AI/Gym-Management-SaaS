import { EventEnvelope } from './event-envelope';
/**
 * Membership domain events
 * Versioned to allow backward compatibility
 */
export interface MembershipStartedPayload {
    membershipId: string;
    memberId: string;
    planId: string;
    startDate: string;
    initialFee: string;
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
export type MembershipStartedEvent = EventEnvelope<MembershipStartedPayload>;
export type MembershipRenewedEvent = EventEnvelope<MembershipRenewedPayload>;
export type MembershipPausedEvent = EventEnvelope<MembershipPausedPayload>;
export type MembershipResumedEvent = EventEnvelope<MembershipResumedPayload>;
export type MembershipCancelledEvent = EventEnvelope<MembershipCancelledPayload>;
export type MembershipTransferredEvent = EventEnvelope<MembershipTransferredPayload>;
export type MembershipFreezeStartedEvent = EventEnvelope<MembershipFreezeStartedPayload>;
export type MembershipFreezeEndedEvent = EventEnvelope<MembershipFreezeEndedPayload>;
export type MembershipEvent = MembershipStartedEvent | MembershipRenewedEvent | MembershipPausedEvent | MembershipResumedEvent | MembershipCancelledEvent | MembershipTransferredEvent | MembershipFreezeStartedEvent | MembershipFreezeEndedEvent;
export declare const EVENT_TYPES: {
    readonly MEMBERSHIP_STARTED: "MembershipStarted";
    readonly MEMBERSHIP_RENEWED: "MembershipRenewed";
    readonly MEMBERSHIP_PAUSED: "MembershipPaused";
    readonly MEMBERSHIP_RESUMED: "MembershipResumed";
    readonly MEMBERSHIP_CANCELLED: "MembershipCancelled";
    readonly MEMBERSHIP_TRANSFERRED: "MembershipTransferred";
    readonly MEMBERSHIP_FREEZE_STARTED: "MembershipFreezeStarted";
    readonly MEMBERSHIP_FREEZE_ENDED: "MembershipFreezeEnded";
};
export declare const EVENT_VERSIONS: {
    readonly V1: "v1";
};
//# sourceMappingURL=membership.events.d.ts.map