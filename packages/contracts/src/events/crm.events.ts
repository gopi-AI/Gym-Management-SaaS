import { EventEnvelope } from './event-envelope';
export interface LeadCreatedPayload { leadId: string; organizationId: string; branchId: string; sourceId?: string | null; status: string; }
export interface LeadContactedPayload { leadId: string; organizationId: string; activityId: string; activityType: string; occurredAt: string; }
export interface LeadQualifiedPayload { leadId: string; organizationId: string; stage: string; qualifiedAt: string; }
export interface MemberConvertedPayload { conversionId: string; leadId: string; memberId: string; membershipId?: string | null; organizationId: string; conversionDate: string; }
export interface LeadLostPayload { leadId: string; organizationId: string; reason: string; lostAt: string; }

/**
 * P3-07 — the four follow-up/SLA events. §9 lists all four as **net-new**
 * ("appear in neither the domain map's event blocks nor `event-contracts.md`"),
 * and the payloads below are the ones §9 proposes, field for field.
 */
export interface FollowUpScheduledPayload { followUpId: string; leadId: string; organizationId: string; dueAt: string; slaPolicyId?: string | null; }
export interface FollowUpCompletedPayload { followUpId: string; leadId: string; organizationId: string; outcome: string; completedAt: string; }
export interface SlaBreachedPayload { breachId: string; leadId: string; organizationId: string; slaPolicyId: string; breachType: string; breachedAt: string; }
export interface SlaEscalatedPayload { breachId: string; leadId: string; organizationId: string; escalatedAt: string; }

export type LeadCreatedEvent = EventEnvelope<LeadCreatedPayload>; export type LeadContactedEvent = EventEnvelope<LeadContactedPayload>; export type LeadQualifiedEvent = EventEnvelope<LeadQualifiedPayload>; export type MemberConvertedEvent = EventEnvelope<MemberConvertedPayload>; export type LeadLostEvent = EventEnvelope<LeadLostPayload>;
export type FollowUpScheduledEvent = EventEnvelope<FollowUpScheduledPayload>; export type FollowUpCompletedEvent = EventEnvelope<FollowUpCompletedPayload>; export type SlaBreachedEvent = EventEnvelope<SlaBreachedPayload>; export type SlaEscalatedEvent = EventEnvelope<SlaEscalatedPayload>;

export type CrmEvent = LeadCreatedEvent | LeadContactedEvent | LeadQualifiedEvent | MemberConvertedEvent | LeadLostEvent | FollowUpScheduledEvent | FollowUpCompletedEvent | SlaBreachedEvent | SlaEscalatedEvent;

/**
 * MUST stay in lockstep with `src/crm/crm.constants.ts` (`CRM_EVENT_TYPES`) and
 * `docs/event-contracts.md`. Production code under `src/` does not import this
 * package (`tsconfig.json` sets `rootDir` to `./src` and excludes `packages`),
 * but specs may: `tsconfig.spec.json` includes `packages/contracts/src/**`
 * (every file beneath it), so the typecheck gate does cover this file.
 */
export const CRM_EVENT_TYPES = { LEAD_CREATED:'LeadCreated', LEAD_CONTACTED:'LeadContacted', LEAD_QUALIFIED:'LeadQualified', MEMBER_CONVERTED:'MemberConverted', LEAD_LOST:'LeadLost', FOLLOW_UP_SCHEDULED:'FollowUpScheduled', FOLLOW_UP_COMPLETED:'FollowUpCompleted', SLA_BREACHED:'SlaBreached', SLA_ESCALATED:'SlaEscalated' } as const;
