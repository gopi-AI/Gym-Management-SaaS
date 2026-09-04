/**
 * Standard event envelope for all domain events published via RabbitMQ
 */
export interface EventEnvelope<TPayload = Record<string, any>> {
    eventId: string;
    eventType: string;
    eventVersion: string;
    organizationId: string;
    occurredAt: string;
    correlationId: string;
    causationId?: string;
    payload: TPayload;
}
/**
 * Event envelope with optional causationId for tracing
 */
export interface EventEnvelopeWithCausation<TPayload = Record<string, any>> extends EventEnvelope<TPayload> {
    causationId: string;
}
/**
 * Helper to create an event envelope
 */
export declare function createEventEnvelope<TPayload>(eventType: string, eventVersion: string, organizationId: string, payload: TPayload, correlationId?: string, causationId?: string): EventEnvelope<TPayload>;
//# sourceMappingURL=event-envelope.d.ts.map