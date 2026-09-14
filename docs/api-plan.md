# API Plan

This document outlines the API design for the Gym Management SaaS platform.

## REST Versioning Policy
- Use URL versioning: `/v1/resource`
- Increment major version for breaking changes
- Minor versions for backward-compatible additions
- Deprecation policy: support old versions for 12 months after deprecation

## Authentication and Authorization
- JWT access tokens (short-lived, 15 minutes)
- Refresh tokens (long-lived, 7 days, rotating)
- Permission claims in JWT: `permissions` array of strings
- Role-based access control (RBAC) enforced at API gateway and service layers
- Branch-scoped permissions for multi-tenant isolation

## Standard Conventions
- Pagination: cursor-based with `limit` and `after` parameters
- Filtering: query parameters following `field[operator]=value` format
- Sorting: `sort` parameter with prefix `-` for descending
- Validation: Zod schemas for request bodies, query parameters, and path parameters
- Idempotency: `Idempotency-Key` header for mutation endpoints (POST, PUT, PATCH, DELETE)
- Optimistic concurrency: `If-Match` header with entity version (ETag)
- Error handling: RFC-7807 Problem Details for HTTP APIs
- Correlation ID: `X-Correlation-ID` header for request tracing
- Rate limiting: per-tenant and per-IP limits with HTTP 429 responses
## Endpoint Catalog (Representative Samples)

### Tenancy
- `GET /v1/organizations` - List organizations (paginated)
- `POST /v1/organizations` - Create organization
- `GET /v1/organizations/{id}` - Get organization details
- `PATCH /v1/organizations/{id}` - Update organization
- `GET /v1/organizations/{orgId}/branches` - List branches for organization
- `POST /v1/organizations/{orgId}/branches` - Create branch

### Identity
- `POST /v1/auth/login` - Authenticate user, returns access and refresh tokens
- `POST /v1/auth/logout` - Invalidate refresh token
- `POST /v1/auth/refresh` - Refresh access token
- `POST /v1/users` - Create user
- `GET /v1/users/{id}` - Get user details
- `PATCH /v1/users/{id}` - Update user
- `POST /v1/users/{id}/mfa/enroll` - Enroll MFA
- `POST /v1/users/{id}/mfa/verify` - Verify MFA code

### Members
- `GET /v1/members` - List members (paginated, filterable)
- `POST /v1/members` - Create member
- `GET /v1/members/{id}` - Get member details
- `PATCH /v1/members/{id}` - Update member
- `GET /v1/members/{id}/identifiers` - List member identifiers
- `POST /v1/members/{id}/identifiers` - Add member identifier
- `DELETE /v1/members/{id}/identifiers/{identifierId}` - Remove member identifier

### Memberships
- `GET /v1/membership-plans` - List membership plans
- `POST /v1/membership-plans` - Create membership plan
- `GET /v1/membership-plans/{id}` - Get membership plan details
- `POST /v1/members/{memberId}/memberships` - Create membership for member
- `GET /v1/memberships/{id}` - Get membership details
- `PATCH /v1/memberships/{id}` - Update membership
- `POST /v1/memberships/{id}/pause` - Pause membership
- `POST /v1/memberships/{id}/resume` - Resume membership
- `POST /v1/memberships/{id}/cancel` - Cancel membership

### Finance
- `GET /v1/invoices` - List invoices (paginated, filterable)
- `POST /v1/invoices` - Create invoice
- `GET /v1/invoices/{id}` - Get invoice details
- `POST /v1/invoices/{id}/payments` - Record payment against invoice
- `GET /v1/payments` - List payments (paginated)
- `GET /v1/payments/{id}` - Get payment details
- `POST /v1/payments/{id}/refunds` - Create refund for payment
- `GET /v1/financial-ledger` - List financial ledger entries (paginated)

### CRM
- `GET /v1/leads` - List leads (paginated, filterable)
- `POST /v1/leads` - Create lead
- `GET /v1/leads/{id}` - Get lead details
- `PATCH /v1/leads/{id}` - Update lead
- `POST /v1/leads/{id}/activities` - Log lead activity
- `POST /v1/leads/{id}/follow-ups` - Schedule follow-up
- `POST /v1/leads/{id}/convert` - Convert lead to member

### PT/Training
- `GET /v1/trainers` - List trainers (paginated)
- `POST /v1/trainers` - Create trainer
- `GET /v1/trainers/{id}` - Get trainer details
- `PATCH /v1/trainers/{id}` - Update trainer
- `POST /v1/trainers/{id}/availability` - Create trainer availability slot
- `GET /v1/pt-packages` - List PT packages
- `POST /v1/pt-packages` - Create PT package
- `GET /v1/members/{memberId}/pt-enrollments` - List PT enrollments for member
- `POST /v1/members/{memberId}/pt-enrollments` - Enroll member in PT package
- `GET /v1/pt-sessions` - List PT sessions (paginated, filterable)
- `POST /v1/pt-sessions` - Schedule PT session

### Scheduling
- `GET /v1/batches` - List batches (paginated, filterable)
- `POST /v1/batches` - Create batch
- `GET /v1/batches/{id}` - Get batch details
- `GET /v1/batch-schedules` - List batch schedules (paginated)
- `POST /v1/batch-schedules` - Create batch schedule
- `GET /v1/services` - List services (paginated)
- `POST /v1/services` - Create service
- `GET /v1/service-schedules` - List service schedules (paginated)
- `POST /v1/service-schedules` - Create service schedule
- `GET /v1/members/{memberId}/batch-enrollments` - List member batch enrollments
- `POST /v1/members/{memberId}/batch-enrollments` - Enroll member in batch
- `GET /v1/members/{memberId}/service-bookings` - List member service bookings
- `POST /v1/members/{memberId}/service-bookings` - Book service for member

### Attendance
- `POST /v1/attendance/events` - Record attendance event (from edge sync)
- `POST /v1/attendance/check-out` - Check a member out (closes their open session)
- `GET /v1/attendance/records` - List attendance records (paginated, filterable)
- `GET /v1/attendance/records/{id}` - Get attendance record details
- `GET /v1/attendance/access-decisions` - List access decisions (paginated)
- `GET /v1/attendance/eligibility-snapshots` - List eligibility snapshots (paginated)

> Phase 1 status: `POST /v1/attendance/events` records a manual front-desk CHECK_IN
> (the event time is stamped by the server, never by the client), `POST
> /v1/attendance/check-out` closes the open session, and `GET
> /v1/attendance/records` / `GET /v1/attendance/records/{id}` / `GET
> /v1/attendance/access-decisions` are implemented. Check-out has its own route
> because it carries its own permission (`attendance:check-out`) and
> `@RequirePermissions` ANDs its entries, so one route could not express
> "check-in OR check-out" without letting a check-in-only operator check members
> out. `GET /v1/attendance/eligibility-snapshots` is NOT implemented: nothing in
> Phase 1 writes an eligibility snapshot (there is no device/edge sync yet), so it
> would always return an empty page. Device-driven events, snapshots and
> `ATTENDANCE_DEVICE_MAPPINGS` arrive with the Phase 2 hardware integration.

### Inventory
- `GET /v1/inventory/items` - List inventory items (paginated, filterable)
- `POST /v1/inventory/items` - Create inventory item
- `GET /v1/inventory/items/{id}` - Get inventory item details
- `PATCH /v1/inventory/items/{id}` - Update inventory item
- `POST /v1/inventory/transactions` - Record inventory transaction
- `GET /v1/inventory/lots` - List inventory lots (paginated, filterable)
- `POST /v1/inventory/purchase-orders` - Create purchase order

### Notifications
- `GET /v1/notification/policies` - List notification policies (paginated)
- `POST /v1/notification/policies` - Create notification policy
- `GET /v1/notification/templates` - List notification templates (paginated)
- `POST /v1/notification/templates` - Create notification template
- `POST /v1/notification/attempts` - Create notification attempt (internal)
- `GET /v1/notification/deliveries` - List notification deliveries (paginated)
- `GET /v1/notification/channels` - List notification channels

### Reports
- `GET /v1/report/schemas` - List report schemas
- `POST /v1/report/schemas` - Create report schema
- `GET /v1/report/schemas/{id}` - Get report schema details
- `POST /v1/report/schemas/{id}/execute` - Execute report (async)
- `GET /v1/report/jobs/{id}` - Get report job status
- `GET /v1/report/materialized-views` - List materialized views
- `GET /v1/report/materialized-views/{id}/data` - Query materialized view
## Webhook Endpoints
- `POST /v1/webhooks/payment-gateway` - Payment gateway webhook (idempotent)
- `POST /v1/webhooks/whatsapp` - WhatsApp message webhook (idempotent)
- `POST /v1/webhooks/sms` - SMS delivery webhook (idempotent)
- `POST /v1/webhooks/email` - Email delivery webhook (idempotent)

## Security Considerations
- All endpoints require valid JWT access token unless marked as public
- Sensitive data (PII, financial) encrypted in request/response logs
- Input validation and sanitization to prevent injection attacks
- Output encoding to prevent XSS in API responses (if applicable)
- Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Strict-Transport-Security
- API endpoints served over HTTPS only
- Regular security scanning and penetration testing

## Documentation
- OpenAPI 3.0 specification generated from code and annotations
- Interactive API documentation via Swagger UI
- Versioned API documentation available at `/docs/v1/`
- Client SDKs generated for popular languages (TypeScript, Python, Java, C#)

## Version Compatibility
- Backward-compatible changes: adding new endpoints, optional fields, new enum values
- Breaking changes: removing endpoints, making fields required, changing data types, removing enum values
- Migration guides provided for breaking changes
- API version header in responses: `API-Version: v1`

## Performance
- Response compression via Gzip
- ETag caching for GET endpoints where appropriate
- Database query optimization and indexing
- Rate limiting to prevent abuse
- Caching of reference data (e.g., countries, currencies) at API gateway

## Monitoring and Observability
- Request logging: method, path, status, duration, user ID, organization ID
- Business event logging for analytics
- Distributed tracing via OpenTelemetry
- Metrics: request rate, error rate, latency, throughput
- Alerting on error rates, latency thresholds, and business anomalies

--- 

*Document Version: 1.0*
*Last Updated: 2026-09-01*