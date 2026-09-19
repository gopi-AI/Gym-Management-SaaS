# Event Contracts

This document outlines the event-driven architecture and contracts for the Gym Management SaaS platform.

## Broker Topology
- Message broker: RabbitMQ (language-agnostic, supports transactions for exactly-once semantics)
- Exchanges: 
  - `gym-management.events` (topic exchange) for publishing domain events
  - `gym-management.commands` (direct exchange) for sending commands (if needed)
- Queues: 
  - Service-specific queues bound to the events exchange with appropriate routing keys
  - Dead letter queues (DLQ) for each service to handle failed message processing
- Routing key pattern: `org.{organizationId}.{eventName}.{version}`

## Envelope Schema
All events published to the broker follow a common envelope structure:
```json
{
  "eventId": "uuid",
  "eventType": "string",
  "eventVersion": "string",
  "organizationId": "uuid",
  "occurredAt": "timestamp (ISO 8601)",
  "correlationId": "uuid",
  "causationId": "uuid",
  "payload": { /* event-specific data */ }
}
```

## Versioned Event Schemas
Events are versioned to allow for backward compatibility. Major version increments indicate breaking changes.

### Membership Events
- `MembershipStarted.v1`
  ```json
  {
    "membershipId": "uuid",
    "memberId": "uuid",
    "planId": "uuid",
    "startDate": "timestamp",
    "initialFee": "decimal"
  }
  ```
- `MembershipRenewed.v1`
  ```json
  {
    "membershipId": "uuid",
    "renewalDate": "timestamp",
    "nextPaymentDate": "timestamp",
    "renewalFee": "decimal"
  }
  ```
- `MembershipPaused.v1`
  ```json
  {
    "membershipId": "uuid",
    "pauseStartDate": "timestamp",
    "pauseEndDate": "timestamp",
    "pauseFee": "decimal"
  }
  ```
- `MembershipCancelled.v1`
  ```json
  {
    "membershipId": "uuid",
    "cancellationDate": "timestamp",
    "reason": "string"
  }
  ```
- `MembershipExpired.v1`
  ```json
  {
    "membershipId": "uuid",
    "memberId": "uuid",
    "expiredAt": "timestamp",
    "endDate": "date (optional)"
  }
  ```
- `MembershipResumed.v1`
  ```json
  {
    "membershipId": "uuid",
    "resumeDate": "timestamp",
    "remainingDays": "integer" // days until the membership end date
  }
  ```
- `MembershipTransferred.v1` (contract defined — **no producer yet**, see implementation note below)
  ```json
  {
    "membershipId": "uuid",
    "memberId": "uuid",
    "fromBranchId": "uuid",
    "toBranchId": "uuid",
    "transferDate": "timestamp"
  }
  ```
- `MembershipFreezeStarted.v1`
  ```json
  {
    "membershipId": "uuid",
    "freezeStartDate": "timestamp",
    "freezeEndDate": "timestamp (optional)", // omitted by the current emitter
    "freezeDurationDays": "integer" // currently always 0 — see implementation note below
  }
  ```
- `MembershipFreezeEnded.v1`
  ```json
  {
    "membershipId": "uuid",
    "freezeEndDate": "timestamp", // when the freeze period ended (unfreeze instant)
    "actualEndDate": "date", // the membership's actual (possibly extended) end date
    "daysRemaining": "integer" // calendar days until the (extended) end date
  }
  ```

**Implementation note (verified against source 2026-09-14).** All five payloads above match the
committed interfaces in `packages/contracts/src/events/membership.events.ts` field for field.
The resumed/freeze events are produced by `MembershipsService.buildLifecycleEventPayload`
(`src/memberships/services/memberships.service.ts`). The counter fields `remainingDays` (resume)
and `daysRemaining` (unfreeze) now compute the actual calendar-day difference against the
membership's `end_date`; `actualEndDate` (unfreeze) carries the membership's (possibly extended)
end date in `YYYY-MM-DD` form while `freezeEndDate` carries the ISO-8601 unfreeze instant.
`freezeDurationDays` remains a hard-coded `0` because no freeze-duration feature exists yet —
freezes are currently open-ended, and `MembershipLifecycleDto` carries only a `reason`.
**`MembershipTransferred.v1` is contract-only: there is no `transfer` transition, service method,
DTO or HTTP endpoint in `src/memberships`, so nothing publishes it yet.**
### Finance Events
- `PaymentSucceeded.v1`
  ```json
  {
    "paymentId": "uuid",
    "invoiceId": "uuid",
    "amount": "decimal",
    "paymentMethod": "string",
    "transactionId": "string",
    "paymentDate": "timestamp"
  }
  ```
- `PaymentFailed.v1`
  ```json
  {
    "paymentId": "uuid",
    "invoiceId": "uuid",
    "amount": "decimal",
    "failureReason": "string",
    "failureCode": "string",
    "paymentDate": "timestamp"
  }
  ```
- `InvoiceCreated.v1`
  ```json
  {
    "invoiceId": "uuid",
    "memberId": "uuid",
    "invoiceNumber": "string",
    "issueDate": "timestamp",
    "dueDate": "timestamp",
    "totalAmount": "decimal",
    "lineItems": [
      {
        "description": "string",
        "quantity": "decimal",
        "unitPrice": "decimal",
        "lineTotal": "decimal",
        "taxCode": "string"
      }
    ]
  }
  ```
- `RefundIssued.v1`
  ```json
  {
    "refundId": "uuid",
    "paymentId": "uuid",
    "invoiceId": "uuid",
    "amount": "decimal",
    "reason": "string",
    "refundDate": "timestamp",
    "status": "string"
  }
  ```
  A refund attaches to a **payment**, not an invoice; `invoiceId` is denormalised
  from the refunded payment so consumers do not have to join back to it. `status`
  is `succeeded` for every refund P3-02 writes, because P3-02 refunds are recorded
  manually; `pending` is reserved for the gateway-initiated path P3-03 adds.
- `CreditNoteIssued.v1`
  ```json
  {
    "creditNoteId": "uuid",
    "invoiceId": "uuid",
    "netAmount": "decimal",
    "taxAmount": "decimal",
    "grossAmount": "decimal",
    "reason": "string",
    "issuedDate": "timestamp",
    "status": "string"
  }
  ```
  A credit note reduces an **invoice** without money moving. The net/tax/gross
  breakdown is carried on the event because it is the tax reversal: `taxAmount` is
  the portion of previously applied tax this note reverses, derived from the
  invoice's own applied rate at creation time. `FINANCE_TAX_LINES` is never
  modified by a credit note, so `taxAmount` here is the authoritative record of
  the reversal.

### Attendance Events
- `AttendanceEventRecorded.v1`
  ```json
  {
    "eventId": "uuid", // the recorded attendance event (ATTENDANCE_ATTENDANCE_EVENTS.id)
    "deviceId": "uuid|null", // null for a staff-initiated manual check-in
    "memberId": "uuid",
    "eventTime": "timestamp",
    "eventType": "string", // e.g., CHECK_IN, CHECK_OUT
    "biometricId": "string|null", // hashed or tokenized biometric identifier; null when manual
    "checkInMethod": "string", // optional, backward-compatible: manual | device | biometric | api
    "checkOutMethod": "string", // optional, backward-compatible: mirror of checkInMethod for CHECK_OUT
    "checkedInBy": "uuid|null" // optional, backward-compatible: staff user id for a manual check-in
  }
  ```
  Phase 1 only produces staff-initiated manual events: `eventTime` is stamped by the
  server (never by the client), `deviceId`/`biometricId` are `null`, exactly one of
  `checkInMethod`/`checkOutMethod` is present (`"manual"`), and `checkedInBy` carries
  the operator. `correlationId` is the attendance *record* id (the check-in/check-out
  session), while `eventId` is the raw event that `ATTENDANCE_ACCESS_DECISIONS`
  points at. The payload is additive-only, so device-driven events (Phase 2) can
  populate the same fields without a version bump.
- `AccessGranted.v1`
  ```json
  {
    "eventId": "uuid",
    "memberId": "uuid",
    "deviceId": "uuid",
    "grantedAt": "timestamp",
    "relayTriggered": true
  }
  ```
- `AccessDenied.v1`
  ```json
  {
    "eventId": "uuid",
    "memberId": "uuid",
    "deviceId": "uuid",
    "deniedAt": "timestamp",
    "reason": "string" // e.g., INACTIVE_MEMBERSHIP, OUT_OF_HOURS
  }
  ```

### Notification Events
- `NotificationSent.v1`
  ```json
  {
    "notificationId": "uuid",
    "templateId": "uuid",
    "recipientId": "uuid",
    "recipientType": "string", // MEMBER, LEAD, STAFF
    "channel": "string", // EMAIL, SMS, WHATSAPP, PUSH
    "sentAt": "timestamp",
    "providerMessageId": "string"
  }
  ```
- `NotificationDeliveryFailed.v1`
  ```json
  {
    "notificationId": "uuid",
    "providerMessageId": "string",
    "failureReason": "string",
    "failedAt": "timestamp"
  }
  ```

### Edge Sync Events
- `SyncCompleted.v1`
  ```json
  {
    "deviceId": "uuid",
    "organizationId": "uuid",
    "eventsSynced": "integer",
    "syncStartedAt": "timestamp",
    "syncCompletedAt": "timestamp",
    "nextSyncCursor": "string"
  }
  ```
- `SyncConflictDetected.v1`
  ```json
  {
    "conflictId": "uuid",
    "deviceId": "uuid",
    "organizationId": "uuid",
    "conflictType": "string", // DUPLICATE_EVENT, ELIGIBILITY_MISMATCH
    "detectedAt": "timestamp",
    "details": { /* conflict-specific data */ }
  }
  ```

## Outbox Pattern
- Events are published via the Outbox table to ensure atomicity with database transactions
- Outbox table schema:
  ```sql
  CREATE TABLE shared.outbox (
    id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    event_version VARCHAR(20) NOT NULL,
    organization_id UUID NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed BOOLEAN NOT NULL DEFAULT FALSE
  );
  ```
- Outbox poller: reads unprocessed events, publishes to broker, marks as processed
- Guarantees: exactly-once delivery to broker (broker deduplicates via eventId in envelope)

## Inbox Pattern
- Services maintain an Inbox table to track processed events and ensure idempotency
- Inbox table schema:
  ```sql
  CREATE TABLE shared.inbox (
    id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    event_version VARCHAR(20) NOT NULL,
    organization_id UUID NOT NULL,
    event_id UUID NOT NULL, -- from envelope
    processed_at TIMESTAMPTZ NOT NULL,
    success BOOLEAN NOT NULL
  );
  UNIQUE KEY (event_type, event_version, organization_id, event_id);
  ```
- On receiving an event, service checks Inbox for duplicate; if not present, processes and records in Inbox
- Failed processing: retry with exponential backoff, move to DLQ after max retries

## Event Versioning and Evolution
- Backward-compatible changes: adding new optional fields to payload
- Breaking changes: removing fields, changing data types, making optional fields required
- Version number format: `{major}.{minor}` (e.g., v1, v2)
- Consumers must handle events of their version and all previous minor versions (e.g., v2 consumer handles v1 and v2)
- Major version increments indicate incompatible changes; consumers must update

## Dead Letter Queue (DLQ) Handling
- Messages that fail processing after max retries (e.g., 3 attempts) are moved to DLQ
- DLQ monitoring: alert on queue depth > 0
- Manual replay: after fixing issue, messages can be replayed from DLQ to main queue
- DLQ payload includes original message and error details

## Security
- Events containing sensitive data (PII, financial) are encrypted in payload using organization-specific keys
- Event broker access: mutual TLS authentication between services and broker
- Authorization: services can only publish/consume events for their organization (multi-tenant isolation)

## Example Event Flow
1. Membership renewal payment processed in Finance service
2. Finance service updates database and writes `PaymentSucceeded.v1` event to Outbox
3. Outbox poller reads event, publishes to `gym-management.events` exchange with routing key `org.{orgId}.PaymentSucceeded.v1`
4. Notification service receives event (via its bound queue), checks Inbox for duplicates
5. Notification service processes event, sends renewal notification via email/SMS
6. Notification service writes `NotificationSent.v1` event to its Outbox
7. Cycle repeats for downstream services

--- 

*Document Version: 1.0*
*Last Updated: 2026-09-14*