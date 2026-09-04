"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEventEnvelope = createEventEnvelope;
/**
 * Helper to create an event envelope
 */
function createEventEnvelope(eventType, eventVersion, organizationId, payload, correlationId, causationId) {
    return {
        eventId: crypto.randomUUID(),
        eventType,
        eventVersion,
        organizationId,
        occurredAt: new Date().toISOString(),
        correlationId: correlationId || crypto.randomUUID(),
        causationId,
        payload,
    };
}
//# sourceMappingURL=event-envelope.js.map