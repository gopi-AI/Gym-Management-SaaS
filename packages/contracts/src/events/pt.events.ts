import { EventEnvelope } from './event-envelope';

/** PT events keep the module's existing version-in-the-name convention. */
export interface PTEnrollmentCreatedPayload {
  enrollmentId: string;
  memberId: string;
  packageId: string;
  trainerId: string;
  startDate: string;
  sessionCount: number;
}

export interface PTSessionBookedPayload {
  sessionId: string;
  enrollmentId: string;
  memberId: string;
  trainerId: string;
  scheduledStart: string;
  scheduledEnd: string;
}

export interface PTSessionCompletedPayload {
  sessionId: string;
  enrollmentId: string;
  actualStart: string;
  actualEnd: string;
}

/**
 * `PTSessionCancelled.v1` payload, per the PT event-contract table in
 * `docs/phase2-scoping-plan.md`: `{ sessionId, enrollmentId, reason, cancelledBy }`.
 *
 * Declared so that `PT_EVENT_TYPES` below mirrors `PT_EVENT_TYPES` in
 * `src/pt/pt.constants.ts`. No PT service publishes this event yet.
 */
export interface PTSessionCancelledPayload {
  sessionId: string;
  enrollmentId: string;
  reason: string;
  cancelledBy: string;
}

export interface TrainerCommissionEarnedPayload {
  commissionId: string;
  enrollmentId: string;
  trainerId: string;
  amount: string;
}

export interface TrainerCommissionClawedBackPayload {
  commissionId: string;
  enrollmentId: string;
  trainerId: string;
  organizationId: string;
  amount: string;
  currency: string;
  reason: string;
  clawedBackAt: string;
}

export interface TrainerCommissionPaidPayload {
  commissionId: string;
  payoutRunId: string;
  trainerId: string;
  organizationId: string;
  amount: string;
  currency: string;
  paidAt: string;
}

export type TrainerCommissionEarnedEvent = EventEnvelope<TrainerCommissionEarnedPayload>;
export type TrainerCommissionClawedBackEvent = EventEnvelope<TrainerCommissionClawedBackPayload>;
export type TrainerCommissionPaidEvent = EventEnvelope<TrainerCommissionPaidPayload>;
export type PTEnrollmentCreatedEvent = EventEnvelope<PTEnrollmentCreatedPayload>;
export type PTSessionBookedEvent = EventEnvelope<PTSessionBookedPayload>;
export type PTSessionCompletedEvent = EventEnvelope<PTSessionCompletedPayload>;
export type PTSessionCancelledEvent = EventEnvelope<PTSessionCancelledPayload>;
export type PtEvent = PTEnrollmentCreatedEvent | PTSessionBookedEvent | PTSessionCompletedEvent |
  PTSessionCancelledEvent | TrainerCommissionEarnedEvent | TrainerCommissionClawedBackEvent |
  TrainerCommissionPaidEvent;

export const PT_EVENT_TYPES = {
  ENROLLMENT_CREATED: 'PTEnrollmentCreated.v1',
  SESSION_BOOKED: 'PTSessionBooked.v1',
  SESSION_COMPLETED: 'PTSessionCompleted.v1',
  SESSION_CANCELLED: 'PTSessionCancelled.v1',
  TRAINER_COMMISSION_EARNED: 'TrainerCommissionEarned.v1',
  TRAINER_COMMISSION_CLAWED_BACK: 'TrainerCommissionClawedBack.v1',
  TRAINER_COMMISSION_PAID: 'TrainerCommissionPaid.v1',
} as const;