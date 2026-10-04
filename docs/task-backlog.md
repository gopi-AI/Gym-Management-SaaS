# Task Backlog

This document contains the implementation tasks broken down by phase, with dependencies and acceptance criteria.

## Phase 0: Architecture/Foundation

### P0-01: Monorepo Setup and Workspace Configuration
- **Objective**: Set up monorepo structure with workspace management for shared packages and consistent tooling.
- **Dependencies**: None
- **Files/modules affected**: 
  - Root package.json
  - packages/ directory (shared, contracts, etc.)
  - apps/ directory (web, admin if needed)
  - Tooling configs (eslint, prettier, typescript, jest)
- **Database changes**: None
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**: 
  - Validate workspace structure
  - Test package linking
  - Verify build scripts work
- **Acceptance criteria**:
  - Monorepo structure established
  - Shared packages usable across apps
  - Consistent linting and formatting across codebase
  - Initial commit with workspace setup
- **Risks**: Tooling complexity, learning curve for team

### P0-02: Contracts Package and Event Schemas
- **Objective**: Create shared contracts package with event schemas, DTOs, and TypeScript interfaces.
- **Dependencies**: P0-01
- **Files/modules affected**:
  - packages/contracts/src/
  - packages/contracts/package.json
### P0-03: Database Setup with Multi-tenancy *(Completed; RLS requirement withdrawn)*
- **Objective**: Create database entities and schema for multi-tenancy support. Tenant isolation is enforced at the **application layer** (per-query `organization_id` predicates resolved from `TenantContextService`); **RLS is formally deferred** — see `docs/database-plan.md`, "Tenant Isolation — Application-Layer Enforcement (RLS Deferred)". The original objective named Row Level Security; that requirement is withdrawn, not outstanding.
- **Dependencies**: P0-01
- **Files/modules affected**:
  - src/tenancy/entities/
  - Database schema (TENANCY_ORGANIZATIONS, TENANCY_BRANCHES)
- **Database changes**:
  - TENANCY_ORGANIZATIONS table
  - TENANCY_BRANCHES table
- **API changes**: None (foundational database task)
- **Acceptance criteria**:
  - Organization entity created with proper columns (id, name, timezone, locale, currency, created_at, updated_at, is_active)
  - Branch entity created with proper columns (id, organization_id, name, address, phone, created_at, updated_at, is_active)
  - Entities properly annotated with TypeORM decorators
  - Tenancy module can import and use these entities

### P0-04: Tenancy Module Implementation
- **Objective**: Implement core tenancy features: organization and branch management.
- **Dependencies**: P0-03 (now completed)
- **Files/modules affected**:
  - src/tenancy/ (module, controller, service, dto, entity)
  - Database migrations for tenancy tables
- **Database changes**:
  - organizations table (completed in P0-03)
  - branches table (completed in P0-03)
  - tenant_settings table
- **API changes**:
  - POST /v1/organizations
  - GET /v1/organizations (paginated)
  - GET /v1/organizations/{id}
  - PATCH /v1/organizations/{id}
  - POST /v1/organizations/{orgId}/branches
  - GET /v1/organizations/{orgId}/branches
  - POST /v1/organizations/{orgId}/tenant-settings
  - GET /v1/organizations/{orgId}/tenant-settings
  - PATCH /v1/organizations/{orgId}/tenant-settings
- **Frontend changes**: None (API only in this phase)
- **Worker changes**: None
- **Tests**:
  - Unit tests for tenancy service
  - Integration tests for tenancy API
  - Tenancy context propagation tests
- **Acceptance criteria**:
  - Organizations and branches can be created via API
  - Tenancy context correctly set for requests
  - Data isolation between tenants
  - API validation and error handling
  - Tenant settings can be created and retrieved
- **Risks**: Tenancy context leakage between requests
- **Files/modules affected**:
  - src/tenancy/ (module, controller, service, dto, entity)
  - Database migrations for tenancy tables
- **Database changes**:
  - organizations table (completed in P0-03)
  - branches table (completed in P0-03)
  - tenant_settings table
- **API changes**:
  - POST /v1/organizations
  - GET /v1/organizations (paginated)
  - GET /v1/organizations/{id}
  - PATCH /v1/organizations/{id}
  - POST /v1/organizations/{orgId}/branches
  - GET /v1/organizations/{orgId}/branches
- **Frontend changes**: None (API only in this phase)
- **Worker changes**: None
- **Tests**:
  - Unit tests for tenancy service
  - Integration tests for tenancy API
  - Tenancy context propagation tests
- **Acceptance criteria**:
  - Organizations and branches can be created via API
  - Tenancy context correctly set for requests
  - Data isolation between tenants
  - API validation and error handling
- **Risks**: Tenancy context leakage between requests

### P0-05: Identity Module and Authentication
- **Objective**: Implement user management, roles, permissions, and JWT authentication.
- **Dependencies**: P0-04
- **Files/modules affected**:
  - src/identity/ (module, service, entity)
  - Database identity tables (IDENTITY_USERS, IDENTITY_ROLES, IDENTITY_PERMISSIONS, IDENTITY_USER_ROLES, IDENTITY_ROLE_PERMISSIONS, IDENTITY_AUTH_TOKENS, IDENTITY_MFA_SECRETS)
- **Database changes**:
  - IDENTITY_USERS table
  - IDENTITY_ROLES table
  - IDENTITY_PERMISSIONS table
  - IDENTITY_USER_ROLES junction table
  - IDENTITY_ROLE_PERMISSIONS junction table
  - IDENTITY_AUTH_TOKENS table
  - IDENTITY_MFA_SECRETS table
- **API changes**: None (foundational module)
- **Frontend changes**: None (API only in this phase)
- **Worker changes**: None
- **Tests**:
  - Unit tests for identity service
  - Authentication flow tests
  - Role-based access control tests
- **Acceptance criteria**:
  - User can be created and retrieved by email
  - Roles and permissions can be managed
  - JWT authentication works correctly
  - Role-based access control is functional
  - MFA secrets can be stored and retrieved
- **Risks**: Password storage security, token expiration handling
### P0-06: Outbox/Inbox Infrastructure
- **Objective**: Implement reliable event publishing with outbox pattern and idempotent consumption with inbox pattern.
- **Dependencies**: P0-03, P0-05
- **Files/modules affected**:
  - shared/outbox/ (entity, repository, service)
  - shared/inbox/ (entity, repository, service)
  - Outbox poller worker
  - Database schema for outbox/inbox
- **Database changes**:
  - shared.outbox table
  - shared.inbox table with unique constraint
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**:
  - Outbox poller worker (Node.js)
  - Inbox processor library
- **Tests**:
  - Outbox exactly-once delivery
  - Inbox duplicate detection
  - Transactional outbox integrity
  - Worker failure recovery
- **Acceptance criteria**:
  - Events published atomically with DB transactions
  - Consumers idempotently process events
  - Outbox poller handles failures gracefully
  - Inbox prevents duplicate processing
- **Risks**: Outbox poller lag, inbox table bloat

### P0-07: Redis Cache Layer
- **Objective**: Implement Redis caching for frequently accessed data with proper invalidation.
- **Dependencies**: P0-01
- **Files/modules affected**:
  - shared/cache/ (module, service)
  - Cache keys and TTL definitions
  - Cache invalidation strategies
### P0-10: S3 Upload Pipeline
- **Objective**: Implement secure file upload to S3 with virus scanning and metadata.
- **Dependencies**: P0-01
- **Files/modules affected**:
  - shared/storage/ (module, service)
  - Upload controller endpoints
  - Virus scanning integration (ClamAV or similar)
  - S3 client configuration
- **Database changes**:
  - Potentially add file metadata tables later
- **API changes**:
## Phase 1: MVP Gym Operations

### P1-01: Member CRUD and Local ID Generation *(Completed)*
- **Objective**: Implement member management with organization-scoped local IDs.
- **Dependencies**: P0-05 (Identity for auth) - completed
- **Files/modules affected**:
  - src/members/entities/member.entity.ts
  - src/members/entities/member-identifier.entity.ts
  - src/members/entities/member-profile.entity.ts
  - src/members/entities/local-id-counter.entity.ts
  - src/members/services/members.service.ts
  - src/members/services/member-identifiers.service.ts
  - src/members/services/local-id.service.ts
  - src/members/controllers/members.controller.ts
  - src/members/controllers/member-identifiers.controller.ts
  - src/members/dto/create-member.dto.ts
  - src/members/dto/update-member.dto.ts
  - src/members/dto/create-member-identifier.dto.ts
  - src/members/dto/list-members.dto.ts
  - src/members/members.module.ts
- **Database changes**:
  - MEMBERS_MEMBERS table (organization_id, branch_id, global_uuid, local_id)
  - MEMBERS_MEMBER_IDENTIFIERS table
  - MEMBERS_MEMBER_PROFILES table
  - MEMBERS_LOCAL_ID_COUNTERS table (organization_id, last_local_id)
- **API changes**:
  - GET /v1/members (paginated, filterable)
  - POST /v1/members
  - GET /v1/members/{id}
  - PATCH /v1/members/{id}
  - GET /v1/members/{id}/identifiers
  - POST /v1/members/{id}/identifiers
  - DELETE /v1/members/{id}/identifiers/{identifierId}
- **Frontend changes**: None (API focused)
- **Worker changes**: None
- **Tests**: Not implemented per instruction
- **Acceptance criteria**:
  - ✅ Members created with unique local_id per organization
  - ✅ Global UUID generated for external reference
  - ✅ Identifiers can be added and removed
  - ✅ API validation and error handling
- **Completion notes**:
  - Local ID generation uses transaction with pessimistic_write lock on MEMBERS_LOCAL_ID_COUNTERS to prevent race conditions.
  - Member creation is wrapped in a DataSource transaction: local ID allocation, member insert, and outbox event are committed atomically.
  - Member endpoints are scoped to the current organization_id from TenantContextService.
  - Identifier endpoints validate member ownership via MembersService.findOne before operations.
  - Duplicate-prevention check rejects create/update when email or phone already exists for an active member in the same organization.
  - Outbox lifecycle events emitted: MEMBER_CREATED, MEMBER_UPDATED, MEMBER_DEACTIVATED.
  - MemberProfile entity created for future profile updates (not exposed via API in P1-01).
  - TypeScript build verified (`npx tsc --noEmit` and `npx tsc` both pass). Root tsconfig.json updated with `include`/`exclude` and `experimentalDecorators`/`emitDecoratorMetadata`.
  - Phase 0 compile-time errors fixed during validation: `BooleanColumn` → `@Column({ type: 'boolean' })`, missing `Injectable`/`CreateDateColumn` imports, incorrect tenancy/identity import paths, missing `IdentityRolePermission` relations/service logic, and `auth.service.ts` syntax correction.
- **Risks**: Local ID counter race conditions, identifier conflicts (mitigated with locking and unique index)

### P1-02: Membership Plans and Sales
- **Objective**: Implement membership plan creation and sales to members.
- **Dependencies**: P1-01
- **Files/modules affected**:
  - src/memberships/ (module, controller, service, dto, entity)
- **Database changes**:
### P1-05: Manual Attendance Check-in
- **Objective**: Implement front desk manual check-in for members.
- **Dependencies**: P1-01
- **Files/modules affected**:
  - src/attendance/ (module, controller, service, dto, entity)
- **Database changes**:
  - attendance_records table (for manual check-in)
- **API changes**:
  - POST /v1/attendance/check-in (manual)
  - GET /v1/attendance/records (paginated)
  - GET /v1/attendance/records/{id}
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Check-in validation (active membership)
  - Duplicate check-in prevention
  - Check-out functionality
  - Attendance reporting
- **Acceptance criteria**:
  - Staff can check-in members manually
  - System prevents double check-in
  - Check-out records exit time
  - Attendance records stored correctly
- **Risks**: Attendance fraud, reporting inaccuracies

### P1-06: Branch Configuration and Settings
- **Objective**: Implement branch-level configuration and settings management.
- **Dependencies**: P0-04
- **Files/modules affected**:
  - src/tenancy/ (settings service)
  - Branch settings entity
- **Database changes**:
  - tenant_settings table (expand for branch-specific)
  - Or create branch_settings table
- **API changes**:
  - GET /v1/branches/{id}/settings
  - PATCH /v1/branches/{id}/settings
  - GET /v1/organizations/{id}/settings
  - PATCH /v1/organizations/{id}/settings
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Settings validation
  - Inheritance (org -> branch override)
  - Setting change auditing
- **Acceptance criteria**:
## Phase 2: Member 360

### P2-01: Member 360 Header API
- **Objective**: Implement API for member 360 header summary.
- **Dependencies**: P1-01, P1-02, P1-03, P1-04
- **Files/modules affected**:
  - src/members/ (service for 360 header)
  - New DTO for header summary
- **Database changes**: None (uses existing tables)
- **API changes**:
  - GET /v1/members/{id}/360/header
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Header data accuracy
  - Response time under SLA
  - Error handling for invalid member
- **Acceptance criteria**:
  - Header shows member name and photo
  - Membership status displayed
  - Access status (granted/denied today)
  - Quick actions available
- **Risks**: Incomplete or stale header data

### P2-02: Memberships Tab API
- **Objective**: Implement API for memberships tab in member 360.
- **Dependencies**: P2-01, P1-02, P1-03
- **Files/modules affected**:
  - src/memberships/ (service for member history)
- **Database changes**: None
- **API changes**:
  - GET /v1/members/{memberId}/memberships (history)
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Historical data retrieval
  - Active vs inactive memberships
  - Pagination for long history
- **Acceptance criteria**:
  - Shows all memberships (past and present)
  - Active membership highlighted
### P2-05: Workouts Tab API
- **Objective**: Implement API for workout plans and assignments tab.
- **Dependencies**: P2-01
- **Files/modules affected**:
  - src/workouts/ (service for workout data)
- **Database changes**:
  - workout_templates table
  - workout_exercises table
  - workout_sessions table
- **API changes**:
  - GET /v1/members/{memberId}/workout-plans
  - GET /v1/members/{memberId}/workout-sessions
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Workout plan retrieval
  - Workout session logging
  - Exercise library integration
- **Acceptance criteria**:
  - Lists assigned workout plans
  - Shows workout session history
  - Exercise details available
  - Progress tracking per assignment
- **Risks**: Workout data inconsistency, missing exercises

### P2-06: Diet Tab API
- **Objective**: Implement API for diet plans and nutrition tracking tab.
- **Dependencies**: P2-01
- **Files/modules affected**:
  - src/diet/ (service for diet data)
- **Database changes**:
  - diet_plans table
  - meal_templates table
  - nutrition_logs table
- **API changes**:
  - GET /v1/members/{memberId}/diet-plans
  - GET /v1/members/{memberId}/nutrition-logs
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Diet plan retrieval
  - Nutrition log storage
  - Meal template usage
- **Acceptance criteria**:
  - Shows assigned diet plans
  - Lists nutrition logs
  - Meal template details available
  - Nutritional summary (calories, macros)
- **Risks**: Nutrition data inaccuracies, template mismatches
## Phase 3: Finance/Inventory/CRM

### P3-01: Financial Ledger Read Model
- **Objective**: Implement financially accurate read model for outstanding balances and reporting.
- **Dependencies**: P1-04
- **Files/modules affected**:
  - src/finance/ (service for ledger queries)
  - Database views or materialized views
  - Possibly denormalized tables for performance
- **Database changes**:
  - Create materialized view for member outstanding balance
  - Create materialized view for revenue by period
  - Indexes on financial ledger for reporting
- **API changes**:
  - GET /v1/members/{id}/outstanding-balance
  - GET /v1/financial-reports/revenue-summary
  - GET /v1/financial-reports/outstanding-by-status
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Balance calculation accuracy
  - Report data matches source transactions
  - Concurrency safety
  - Performance with large datasets
- **Acceptance criteria**:
  - Outstanding balance = sum of unpaid invoices
  - Revenue reports match paid invoices
  - Reports generated quickly
  - Data consistent with source of truth
- **Risks**: Report inaccuracies, performance degradation

### P3-02: Refunds and Credit Notes
- **Objective**: Implement full refund and credit note lifecycle.
- **Dependencies**: P1-04
- **Files/modules affected**:
  - src/finance/ (refund and credit note service)
- **Database changes**:
  - refunds table (NOT built in P1-04 — the Phase 1 finance migration deliberately
    created only invoices, invoice items, payments and the invoice-number counter;
    refunds are created by this task)
  - credit_notes table (NOT built in P1-04, for the same reason — created by this task)
- **API changes**:
  - POST /v1/payments/{id}/refunds (enhanced)
  - POST /v1/invoices/{id}/credit-notes
  - GET /v1/refunds (paginated)
  - GET /v1/credit-notes (paginated)
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Refund validation (amount <= payment)
  - Credit note validation (amount <= invoice)
  - Financial ledger impact
  - Reversal scenarios
- **Acceptance criteria**:
  - Refunds correctly reduce payment amount
  - Credit notes correctly reduce invoice amount
  - Both update financial ledger
  - Cannot refund more than collected
- **Risks**: Financial inaccuracies, fraud opportunities
### P3-03: Payment Gateway Integration
- **Objective**: Integrate with real payment gateway (e.g., Stripe) with webhook handling.
- **Dependencies**: P1-04, P0-06 (for idempotency)
- **Files/modules affected**:
  - src/finance/ (payment service enhancement)
  - Webhook controller
  - Payment provider adapters
- **Database changes**:
  - Enhance payments table with gateway-specific fields
  - Potentially add webhook logs table
- **API changes**:
  - POST /v1/payments/{id}/process (initiate gateway payment)
  - POST /v1/webhooks/payment-gateway (idempotent)
- **Frontend changes**: None
- **Worker changes**:
  - Payment retry worker (enhanced for gateway)
  - Webhook processing worker (if using queue)
- **Tests**:
  - Successful payment flow
  - Failed payment handling
  - Webhook idempotency
  - Refund via gateway
- **Acceptance criteria**:
  - Payments processed via gateway
  - Webhooks handled idempotently
  - Failed payments retry appropriately
  - Refunds processed via gateway
- **Risks**: Security vulnerabilities, financial losses

### P3-04: Tax Handling (tax-only; discounts split to P3-04b)
- **Objective**: Implement tax calculation. Discounts are explicitly OUT of scope for
  this item and tracked separately as P3-04b (see below).
- **Dependencies**: P1-04
- **Files/modules affected**:
  - src/finance/ (tax rate configuration + tax calculation)
  - src/members/ (tax-exemption flag on the member)
- **Database changes**:
  - `FINANCE_TAX_RATES` (net-new; not in the ERD) — per-organization configurable rates
  - `FINANCE_TAX_LINES` (NOT built in P1-04 — the Phase 1 finance migration created
    only invoices, invoice items, payments and the invoice-number counter)
  - `MEMBERS_MEMBERS.tax_exempt` + `tax_exempt_reason` (net-new columns)
  - membership_discounts table — MOVED to P3-04b; it was NOT built in P1-03
- **API changes**:
  - GET /v1/tax-rates
  - POST /v1/tax-rates (admin — `finance:admin`, provisioned in migration 1788965263254)
  - Enhance invoice creation with tax
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Tax calculation accuracy
  - Tax-exempt handling
  - Backwards compatibility (a line without a tax_code still yields tax_amount = 0.00)
- **Acceptance criteria**:
  - Tax calculated correctly from the organization's configured rates
  - Tax-exempt members are charged no tax, and the zero-rated result is still
    recorded as an audit row
  - Tax reporting data available (`FINANCE_TAX_LINES`)
- **Risks**: Tax calculation errors, compliance issues

### P3-04b: Membership Discounts (split out of P3-04)
- **Objective**: Implement first-class discounting on memberships.
- **Dependencies**: P3-04
- **Files/modules affected**:
  - src/memberships/ (discount definition — Membership owns it)
  - src/finance/ (discount application on the invoice)
- **Database changes**:
  - membership_discounts table (NOT built in P1-03 — there was no `MembershipDiscount`
    entity or discount service in the codebase; verified 2026-09-17. **Built in P3-04b as
    `021dc160`** on 2026-09-28: `src/memberships/entities/membership-discount.entity.ts`,
    `MembershipsService.addDiscount`, migration `1788965263262-CreateMembershipDiscounts.ts`)
- **API changes**:
  - POST /v1/memberships/{id}/discount
  - Enhance invoice creation with discount application
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Discount application rules
  - Combined tax and discount scenarios — the *fixed* discount-before-tax order
    (pinned at `src/finance/services/invoices.service.spec.ts:330`; the
    "configurable discount-before-tax vs discount-after-tax order" this bullet
    originally asked for was dropped by the plan §15 Q9(a) ruling, 2026-09-27)
- **Acceptance criteria**:
  - Discounts applied **before** tax — fixed order (**relaxed 2026-09-27** per plan
    §15 Q9(a): ordering is hard-coded discount-before-tax *by design, not
    configurable*; no known customer or jurisdiction requirement for the
    alternative ordering, revisit if one emerges)
  - Discount definitions owned by Membership, applied by Finance
- **Risks**: Discount calculation errors, unintended revenue leakage

### P3-05: Inventory Management
- **Objective**: Implement inventory tracking for retail items and supplies.
- **Dependencies**: P0-01
- **Files/modules affected**:
  - src/inventory/ (module, controller, service, dto, entity)
- **Database changes**:
  - inventory_items table
  - inventory_transactions table
  - inventory_lots table
  - suppliers table
  - purchase_orders table
- **API changes**:
  - GET /v1/inventory/items (paginated, filterable)
  - POST /v1/inventory/items
  - GET /v1/inventory/items/{id}
  - PATCH /v1/inventory/items/{id}
  - POST /v1/inventory/transactions
  - GET /v1/inventory/lots (paginated, filterable)
  - POST /v1/inventory/purchase-orders
  - GET /v1/inventory/purchase-orders/{id}
- **Frontend changes**: None
- **Worker changes**:
  - Inventory reorder worker (suggests POs)
  - Expiry checker worker (for lot expiration)
- **Tests**:
  - Stock level calculations
  - Transaction types (in/out/adjustment)
  - Lot tracking and expiry
  - Purchase order lifecycle
- **Acceptance criteria**:
  - Items tracked with SKU, description, cost
  - Stock levels updated on transactions
  - Lot expiry tracking
  - Purchase orders created and received
- **Risks**: Inventory shrinkage, stock inaccuracies

### P3-06: CRM Lead Management
- **Objective**: Implement lead tracking, follow-up, and conversion funnel.
- **Dependencies**: P0-05 (Identity for auth)
- **Files/modules affected**:
  - src/crm/ (module, controller, service, dto, entity)
- **Database changes**:
  - leads table
  - lead_sources table
  - lead_stages table
  - lead_activities table
  - follow_ups table
  - trials table
  - visits table
  - conversions table
- **API changes**:
  - GET /v1/leads (paginated, filterable)
  - POST /v1/leads
  - GET /v1/leads/{id}
  - PATCH /v1/leads/{id}
  - POST /v1/leads/{id}/activities
  - POST /v1/leads/{id}/follow-ups
  - POST /v1/leads/{id}/convert
  - GET /v1/leads/{id}/trials
- **Frontend changes**: None
- **Worker changes**:
  - Lead nurturing worker (automated follow-ups)
  - Follow-up scheduler worker
- **Tests**:
  - Lead lifecycle progression
  - Activity and follow-up logging
  - Conversion tracking accuracy
  - Lead source attribution
- **Acceptance criteria**:
  - Leads created and tracked
  - Activities and follow-ups recorded
  - Leads can be converted to members
  - Trial memberships created
- **Risks**: Lead leakage, incorrect conversion tracking
## Phase 4: Biometric + Offline Edge

### P4-01: Device Registry and Credentials
- **Objective**: Implement device registry for biometric devices and credential management.
- **Dependencies**: P0-05 (for auth/security)
- **Files/modules affected**:
  - src/edge-agent/ (module for device management)
  - Device registry entity and service
- **Database changes**:
  - device_registry table
  - device_credentials table
  - device_metadata table
- **API changes**:
  - GET /v1/edge/devices (paginated)
  - POST /v1/edge/devices
  - GET /v1/edge/devices/{id}
  - PATCH /v1/edge/devices/{id}
  - DELETE /v1/edge/devices/{id}
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Device registration validation
  - Credential security (encryption at rest)
  - Device status tracking
  - Credential rotation
- **Acceptance criteria**:
  - Devices registered with unique identifiers
  - Credentials stored securely
  - Device status (online/offline) tracked
  - Credentials can be rotated
- **Risks**: Credential leakage, device impersonation

### P4-02: Edge Agent Core (SQLite, Queue)
- **Objective**: Build core edge agent components: SQLite database and persistent queue.
- **Dependencies**: None (can start early)
- **Files/modules affected**:
  - Edge agent SQLite schema
  - Outbox/inbox tables for edge agent
  - Sync manager logic
- **Database changes** (edge agent local SQLite):
  - Local outbox table (events to upload)
### P4-05: Eligibility Snapshot Distributor
- **Objective**: Implement worker that distributes eligibility snapshots to edge agents.
- **Dependencies**: P1-02, P1-03, P1-04 (eligibility determination)
- **Files/modules affected**:
  - src/edge-agent/ (service for eligibility distribution)
  - Worker that runs periodically
- **Database changes**:
  - eligibility_snapshots table (may enhance from P0-03)
  - Potentially snapshot_metadata table
- **API changes**:
  - GET /v1/edge/eligibility-snapshots/{orgId} (for edge pull)
  - Or worker pushes via internal API
- **Frontend changes**: None
- **Worker changes**:
  - Eligibility snapshot distributor worker
- **Tests**:
  - Snapshot accuracy (matches membership status)
  - Distribution timing and frequency
  - Handling of eligibility changes
  - Snapshot size and performance
- **Acceptance criteria**:
  - Snapshots accurately reflect eligibility
  - Distributed to edge agents on schedule
  - Updates sent when eligibility changes
  - Edge agents can apply snapshots correctly
- **Risks**: Stale eligibility data, distribution failures

### P4-06: Sync Ingest API
- **Objective**: Implement API endpoint for edge agents to upload batches of events.
- **Dependencies**: P0-06 (outbox/inbox), P0-05 (auth)
- **Files/modules affected**:
  - src/edge-sync/ (module for sync ingest)
  - Controller and service for ingest
- **Database changes**:
  - May enhance shared.inbox for edge events
  - Or create edge_specific tables
- **API changes**:
  - POST /v1/edge/sync (main ingest endpoint)
  - GET /v1/edge/sync/status/{deviceId}
  - GET /v1/edge/conflicts (paginated)
  - POST /v1/edge/conflicts/{id}/resolve
## Phase 5: Notifications/Marketing

### P5-01: Notification Policy Engine
- **Objective**: Implement engine for evaluating notification triggers and conditions.
- **Dependencies**: P0-06 (events), P0-05 (auth)
- **Files/modules affected**:
  - src/notifications/ (policy engine service)
  - Policy evaluation logic
  - Condition language implementation
- **Database changes**:
  - notification_policies table
  - policy_execution_log table
- **API changes**:
  - GET /v1/notification/policies (paginated)
  - POST /v1/notification/policies
  - GET /v1/notification/policies/{id}
  - PATCH /v1/notification/policies/{id}
- **Frontend changes**: None
- **Worker changes**:
  - Notification policy evaluator worker
- **Tests**:
  - Trigger evaluation accuracy
  - Condition language parsing
  - Policy execution timing
  - Concurrent policy safety
- **Acceptance criteria**:
  - Policies correctly evaluate triggers
  - Conditions work as specified
  - Policies executed on schedule or event
  - Execution logged for auditing
- **Risks**: Policy engine performance, incorrect evaluations

### P5-02: Template Resolver and Personalization
- **Objective**: Implement template system with personalization and localization.
- **Dependencies**: P5-01
- **Files/modules affected**:
  - src/notifications/ (template service)
  - Template storage and versioning
  - Personalization engine (handlebar-like)
  - Internationalization support
- **Database changes**:
### P5-04: WhatsApp Adapter
- **Objective**: Implement adapter for WhatsApp Business API delivery.
- **Dependencies**: P5-01, P5-02, P5-03
- **Files/modules affected**:
  - src/notifications/channels/whatsapp/
  - WhatsApp API integration
  - Template message handling (HSM)
- **Database changes**:
  - Enhance notification_channels for Whatsam
  - WhatsApp-specific message templates
- **API changes**:
  - WhatsApp channel CRUD (same as P5-03)
- **Frontend changes**: None
- **Worker changes**:
  - WhatsApp adapter worker
- **Tests**:
  - Template message submission
  - Session message handling
  - Media message support
  - Opt-in/opt-out compliance
- **Acceptance criteria**:
  - WhatsApp messages sent via API
  - Template messages work correctly
  - Media messages supported
  - Opt-in status respected
- **Risks**: WhatsApp policy violations, message blocking

### P5-05: Delivery Tracking and DLQ
- **Objective**: Implement delivery tracking, failure handling, and dead letter queue.
- **Dependencies**: P5-01 through P5-04
- **Files/modules affected**:
  - src/notifications/ (tracking service)
  - Dead letter queue implementation
  - Retry logic with exponential backoff
- **Database changes**:
  - notification_attempts table (enhance)
  - notification_deliveries table (enhance)
  - notification_dlq table (dead letter queue)
- **API changes**:
  - GET /v1/notification/deliveries (paginated)
  - GET /v1/notification/dlq (paginated)
## Phase 6: Analytics

### P6-01: Read Replica and Reporting Schema
- **Objective**: Set up PostgreSQL read replica and reporting schema for analytics.
- **Dependencies**: P0-03
- **Files/modules affected**:
  - Database replication configuration
  - Reporting schema creation
  - Connection routing configuration
- **Database changes**:
  - Configure read replica
  - Create reporting schema
  - Set up replication slots
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Replica lag monitoring
  - Query routing to replica
  - Data consistency checks
  - Failover simulation
- **Acceptance criteria**:
  - Read replica replicating correctly
  - Reporting schema isolated
  - Queries routed to replica
  - Lag within acceptable limits
- **Risks**: Replication lag, inconsistency

### P6-02: Python Reporting Worker
- **Objective**: Implement Python worker for generating reports and analytics.
- **Dependencies**: P6-01
- **Files/modules affected**:
  - Python reporting service
  - Report generation logic
  - Scheduled report execution
- **Database changes**:
  - Potentially add report scheduling tables
  - Or use existing tables
- **API changes**:
  - POST /v1/report/schemas/{id}/execute
  - GET /v1/report/jobs/{id}
### P6-04: Reconciliation Workers
- **Objective**: Implement workers for reconciling data between systems.
- **Dependencies**: P1-04, P3-03, P4-06
- **Files/modules affected**:
  - src/finance/ (reconciliation service)
  - src/attendance/ (reconciliation service)
  - src/edge-sync/ (reconciliation service)
- **Database changes**:
  - reconciliation_logs table
  - Potentially discrepancy tables
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**:
  - Financial reconciliation worker (ledger vs gateway)
  - Attendance reconciliation worker (device vs cloud)
  - Edge sync reconciliation worker (eligibility vs events)
- **Tests**:
  - Reconciliation accuracy
  - Discrepancy detection and logging
  - Automatic correction where possible
  - Manual intervention workflow
- **Acceptance criteria**:
  - Reconciles financial ledger with gateway statements
  - Matches device events with cloud records
  - Validates edge eligibility decisions
  - Logs discrepancies for investigation
- **Risks**: Reconciliation loops, missed discrepancies

### P6-05: Analytics Dashboards
- **Objective**: Create analytics dashboards for business insights.
- **Dependencies**: P6-01 through P6-04
- **Files/modules affected**:
  - apps/web/analytics/ (pages and components)
  - Dashboard layouts and widgets
  - Charting library integration
- **Database changes**: None
- **API changes**: None
- **Frontend changes**:
  - Analytics dashboard route
  - Widget components (charts, tables, metrics)
  - Date range selectors
## Phase 7: Enterprise Scale

### P7-01: Partitioning and Archival Strategy
- **Objective**: Implement table partitioning and data archival for large tables.
- **Dependencies**: P6-01 (read replica for reporting)
- **Files/modules affected**:
  - Database partitioning procedures
  - Archival jobs and procedures
  - Partition maintenance scripts
- **Database changes**:
  - Partition attendance_events by month
  - Partition financial_ledger by year
  - Create archival tables
  - Set up partitioning maintenance
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**:
  - Partition maintenance worker
  - Archival worker (move to cold storage)
- **Tests**:
  - Partition creation and maintenance
  - Query performance on partitions
  - Archival and retrieval process
  - Point-in-time recovery with partitions
- **Acceptance criteria**:
  - Large tables partitioned correctly
  - Queries route to appropriate partitions
  - Archival moves data to cost-effective storage
  - Retrieval works when needed
- **Risks**: Partitioning errors, archival failures

### P7-02: Platform Administration
- **Objective**: Implement platform-level administration features.
- **Dependencies**: P0-04, P0-05
- **Files/modules affected**:
  - src/platform-admin/ (new module)
  - Platform-wide settings and billing
  - Organization provisioning workflow
- **Database changes**:
  - platform_settings table
  - organization_billing table
### P7-04: Load/Chaos Gates
- **Objective**: Implement performance testing and chaos engineering gates.
- **Dependencies**: P6-01 (baseline metrics)
- **Files/modules affected**:
  - Chaos testing framework
  - Load testing scripts
  - Performance monitoring enhancement
  - Gate definitions (pass/fail criteria)
- **Database changes**: None
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Load testing at expected scale
  - Chaos experiments (network, instance failure)
  - Performance regression detection
  - Recovery time objectives
- **Acceptance criteria**:
  - System handles expected load
  - Graceful degradation under failure
  - Recovery within time objectives
  - No data loss during chaos tests
- **Risks**: Test environment differences, false negatives

### P7-05: DR Drill Automation
- **Objective**: Automate disaster recovery drills and validation.
- **Dependencies**: P7-04, P0-09 (CI/CD for deployment)
- **Files/modules affected**:
  - DR runbook automation
  - Failover testing scripts
  - Data validation procedures
  - Cutover and switchback procedures
- **Database changes**: None
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Full failover drill execution
  - Data integrity validation
  - Application functionality testing
  - Performance baseline confirmation
- **Acceptance criteria**:
  - Failover completes within RTO
  - Data integrity verified
  - Application functions correctly
  - Performance meets SLAs
  - Switchback procedure works
- **Risks**: DR plan gaps, incomplete validation

--- 

*Document Version: 1.0*
*Last Updated: 2026-09-01*
  - provisioning_requests table
  - audit_log enhancements for platform actions
- **API changes**:
  - Platform admin APIs (internal)
  - Organization provisioning endpoints
  - Platform settings endpoints
- **Frontend changes**:
  - Platform admin dashboard
  - Organization management
  - Billing and subscription management
  - System health monitoring
- **Worker changes**:
  - Provisioning workflow worker
  - Billing cycle worker
- **Tests**:
  - Organization provisioning flow
  - Platform settings management
  - Billing and invoicing
  - Health monitoring alerts
- **Acceptance criteria**:
  - Platform admins can manage system
  - Organizations can be provisioned
  - Billing and invoicing works
  - System health visible
- **Risks**: Platform security breach, billing errors

### P7-03: SaaS Subscription Billing
- **Objective**: Implement billing for the platform itself to customers.
- **Dependencies**: P7-02, P3-04
- **Files/modules affected**:
  - src/platform-billing/ (new module)
  - Subscription plans and cycles
  - Usage-based billing if applicable
- **Database changes**:
  - platform_subscription_plans table
  - organization_subscriptions table
  - usage_metrics table (if applicable)
  - platform_invoices table
- **API changes**:
  - Platform billing APIs
  - Usage reporting endpoints
  - Invoice and payment endpoints
- **Frontend changes**:
  - Billing portal for organizations
  - Subscription management
  - Usage dashboard
- **Worker changes**:
  - Subscription renewal worker
  - Usage aggregation worker
- **Tests**:
  - Subscription creation and renewal
  - Usage-based billing accuracy
  - Proration and plan changes
  - Payment failure handling
- **Acceptance criteria**:
  - Organizations subscribed to plans
  - Usage billed correctly if applicable
  - Plan changes handled correctly
  - Payment failures managed
- **Risks**: Billing errors, revenue leakage
  - Export functionality (CSV, Excel)
  - Drill-down capabilities
- **Worker changes**: None
- **Tests**:
  - Dashboard load performance
  - Chart data accuracy
  - Interactive functionality
  - Export correctness
- **Acceptance criteria**:
  - Dashboard loads within SLA
  - Charts display accurate data
  - Interactive elements work
  - Export produces correct files
- **Risks**: Dashboard performance, misleading visualizations
  - GET /v1/report/jobs (history)
- **Frontend changes**: None
- **Worker changes**:
  - Python reporting worker (Celery or similar)
- **Tests**:
  - Report generation accuracy
  - Scheduled report execution
  - Report performance
  - Error handling and retry
- **Acceptance criteria**:
  - Reports generated accurately
  - Scheduled reports run on time
  - Performance within SLAs
  - Failed reports retry appropriately
- **Risks**: Report inaccuracies, performance issues

### P6-03: Materialized Views for Reporting
- **Objective**: Create materialized views for common reporting queries.
- **Dependencies**: P6-01
- **Files/modules affected**:
  - Database materialized view definitions
  - Refresh schedules and procedures
- **Database changes**:
  - Create materialized views:
    - Member summary dashboard
    - Monthly revenue by organization
    - Attendance trends and peak times
    - Membership growth and churn
    - Financial summary reports
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**:
  - Materialized view refreshed worker
- **Tests**:
  - Materialized view accuracy
  - Refresh performance
  - Concurrent refresh handling
  - Stale data detection
- **Acceptance criteria**:
  - Views match source query results
  - Refresh completes within window
  - Concurrent access handled
  - Stale data indicated appropriately
- **Risks**: View refresh failures, stale data
  - POST /v1/notification/dlq/{id}/retry
- **Frontend changes**: None
- **Worker changes**:
  - Delivery tracker worker
  - DLQ processor worker
  - Retry worker with backoff
- **Tests**:
  - Delivery status tracking
  - Failed delivery retry logic
  - DLQ message handling
  - Manual replay from DLQ
- **Acceptance criteria**:
  - Delivery attempts logged with status
  - Failed deliveries retried with backoff
  - Permanently failed moves to DLQ
  - DLQ messages can be replayed
- **Risks**: DLQ buildup, retry storms

### P5-06: Campaign Management
- **Objective**: Implement marketing campaign creation and execution.
- **Dependencies**: P5-01 through P5-05
- **Files/modules affected**:
  - src/notifications/ (campaign service)
  - Campaign definition and execution
  - Member segmentation and targeting
- **Database changes**:
  - campaigns table
  - campaign_logs table
  - segmentation_rules table
  - campaign_targets table
- **API changes**:
  - GET /v1/campaigns (paginated, filterable)
  - POST /v1/campaigns
  - GET /v1/campaigns/{id}
  - PATCH /v1/campaigns/{id}
  - POST /v1/campaigns/{id}/execute
  - GET /v1/segmentation/rules
- **Frontend changes**: None
- **Worker changes**:
  - Campaign execution worker
  - Segmentation worker
- **Tests**:
  - Campaign creation and scheduling
  - Segmentation accuracy
  - Campaign execution tracking
  - A/B testing functionality
- **Acceptance criteria**:
  - Campaigns can be created and scheduled
  - Members correctly segmented
  - Campaigns executed as specified
  - Results tracked and reported
- **Risks**: Campaign fatigue, incorrect targeting
  - notification_templates table
  - template_versions table
  - template_languages table
- **API changes**:
  - GET /v1/notification/templates (paginated)
  - POST /v1/notification/templates
  - GET /v1/notification/templates/{id}
  - PATCH /v1/notification/templates/{id}
- **Frontend changes**: None
- **Worker changes**:
  - Template resolver worker (for merging data)
- **Tests**:
  - Template rendering accuracy
  - Personalization data substitution
  - Language fallback and localization
  - Template versioning
- **Acceptance criteria**:
  - Templates render with correct data
  - Personalization tags replaced
  - Multi-language support
  - Template versioning works
- **Risks**: Template injection, personalization errors

### P5-03: Channel Adapters (Email/SMS)
- **Objective**: Implement adapters for email and SMS delivery channels.
- **Dependencies**: P5-01, P5-02
- **Files/modules affected**:
  - src/notifications/channels/email/
  - src/notifications/channels/sms/
  - Adapter interfaces and implementations
- **Database changes**:
  - notification_channels table (config)
  - notification_attempts table (enhance)
  - notification_deliveries table (enhance)
- **API changes**:
  - GET /v1/notification/channels
  - POST /v1/notification/channels
  - GET /v1/notification/channels/{id}
  - PATCH /v1/notification/channels/{id}
- **Frontend changes**: None
- **Worker changes**:
  - Email adapter worker
  - SMS adapter worker
  - Delivery tracking worker
- **Tests**:
  - Email delivery success/failure
  - SMS delivery success/failure
  - Rate limiting and throttling
  - Provider error handling
- **Acceptance criteria**:
  - Email sent via provider API
  - SMS sent via provider API
  - Delivery tracking recorded
  - Errors handled and retried
- **Risks**: Delivery failures, cost overruns, provider issues
- **Frontend changes**: None
- **Worker changes**:
  - Batch sync processor worker (handles incoming batches)
  - Conflict detector worker
- **Tests**:
  - Batch validation and processing
  - Idempotency (duplicate batch handling)
  - Conflict detection logic
  - Error handling and rejection
- **Acceptance criteria**:
  - Accepts and validates event batches
  - Processes batches idempotently
  - Detects and logs conflicts
  - Returns appropriate sync receipt
- **Risks**: Ingest bottleneck, duplicate processing

### P4-07: Access Decision Engine and Relay Control
- **Objective**: Implement local access decision engine and relay control logic.
- **Dependencies**: P4-02, P4-05
- **Files/modules affected**:
  - src/edge-agent/ (access decision service)
  - Relay controller interface
  - Configuration for rules (anti-passback, time windows)
- **Database changes** (edge local):
  - access_decisions table (for local audit)
  - relay_state table
  - anti_passback_state table
- **API changes**: None (edge internal)
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Eligibility evaluation
  - Time window validation
  - Anti-passback rule enforcement
  - Relay triggering logic
- **Acceptance criteria**:
  - Correctly grants/denies access based on rules
  - Triggers relay for granted access
  - Logs all decisions with reasons
  - Handles edge cases (expired, blocked, etc.)
- **Risks**: Incorrect access decisions, relay failures

### P4-08: Offline Conflict Handling
- **Objective**: Implement conflict detection and resolution mechanisms.
- **Dependencies**: P4-06, P4-07
- **Files/modules affected**:
  - src/edge-sync/ (conflict detection service)
  - Conflict resolution workflow
  - UI for manual resolution
- **Database changes**:
  - sync_conflicts table (enhanced from planning)
  - conflict_resolution_log table
- **API changes**:
  - GET /v1/edge/conflicts (enhanced)
  - POST /v1/edge/conflicts/{id}/resolve
  - GET /v1/edge/sync/status (enhanced)
- **Frontend changes**: None
- **Worker changes**:
  - Conflict detector worker
  - Conflict resolution worker (suggests resolutions)
- **Tests**:
  - Duplicate event detection
  - Eligibility mismatch detection
  - Clock skew detection and handling
  - Resolution workflow execution
- **Acceptance criteria**:
  - Detects duplicate events correctly
  - Identifies eligibility mismatches
  - Handles clock skew appropriately
  - Provers resolution suggestions
- **Risks**: Incorrect conflict resolution, data loss

### P4-09: Edge E2E Chaos Tests
- **Objective**: Create end-to-end chaos tests for edge agent scenarios.
- **Dependencies**: P4-01 through P4-08
- **Files/modules affected**:
  - Test suite for edge-agent-cloud interaction
  - Chaos injection tools (network, latency, failure)
  - Test data generators
- **Database changes**: None
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Network partition simulation
  - Device failure scenarios
  - Clock drift injection
  - Power loss and recovery
  - Malicious data injection
- **Acceptance criteria**:
  - System maintains safety during failures
  - Data consistency after recovery
  - Access decisions conservative during uncertainty
  - Recovery automatic where possible
- **Risks**: Test complexity, false positives in chaos testing
  - Local inbox table (processed cloud messages)
  - Eligibility cache table
  - Device state table
- **API changes**: None (edge internal)
- **Frontend changes**: None
- **Worker changes**: None (edge agent is the worker)
- **Tests**:
  - SQLite schema integrity
  - Queue persistence across restarts
  - Idempotency in outbox/inbox
  - Crash recovery
- **Acceptance criteria**:
  - Local SQLite database initialized
  - Events queued persistently
  - State recovered after crash
  - Idempotency prevents duplicates
- **Risks**: Database corruption, queue loss

### P4-03: ZKTeco Device Adapter
- **Objective**: Implement adapter for ZKTeco biometric devices.
- **Dependencies**: P4-02
- **Files/modules affected**:
  - src/edge-agent/adapters/zkteco/
  - Device communication logic
  - Event translation to internal format
- **Database changes**: None (edge local)
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Device connection and discovery
  - Event capture (fingerprint, card, etc.)
  - Error handling and timeouts
  - Communication protocol compliance
- **Acceptance criteria**:
  - Successfully connects to ZKTeco device
  - Receives biometric events
  - Translates to internal event format
  - Handles device errors gracefully
- **Risks**: SDK compatibility, device communication failures

### P4-04: eSSL Device Adapter
- **Objective**: Implement adapter for eSSL biometric devices.
- **Dependencies**: P4-02
- **Files/modules affected**:
  - src/edge-agent/adapters/essl/
  - Device communication logic
  - Event translation to internal format
- **Database changes**: None (edge local)
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Device connection and discovery
  - Event capture (fingerprint, face, etc.)
  - Error handling and timeouts
  - Communication protocol compliance
- **Acceptance criteria**:
  - Successfully connects to eSSL device
  - Receives biometric events
  - Translates to internal event format
  - Handles device errors gracefully
- **Risks**: SDK compatibility, device communication failures

### P3-07: Follow-ups and SLAs
- **Objective**: Implement automated follow-up tasks and service level agreements.
- **Dependencies**: P3-06
- **Files/modules affected**:
  - src/crm/ (follow-up service enhancement)
  - SLA tracking entities
- **Database changes**:
  - Enhance follow_ups table with SLA fields
  - Create sla_policies table
  - Create sla_breaches table
- **API changes**:
  - GET /v1/follow-ups/due
  - POST /v1/follow-ups/{id}/complete
  - GET /v1/sla/reports
- **Frontend changes**: None
- **Worker changes**:
  - Follow-up scheduler worker (enhanced)
  - SLA monitoring worker
- **Tests**:
  - Follow-up due date calculation
  - SLA timing and escalation
  - Overdue follow-up reporting
  - Escalation workflow
- **Acceptance criteria**:
  - Follow-ups generated per SLA
  - Overdue follow-ups escalated
  - SLA compliance tracked
  - Escalation notifications sent
- **Risks**: Follow-up fatigue, SLA gaming

### P3-08: Dunning
- **Objective**: Chase invoices still unpaid after the payment-retry worker has exhausted its
  attempts, by publishing overdue and escalation events from a worker-driven scan.
  **Shipped in `b4b6464d`.** This backlog entry was missing until 2026-09-30; plan §5 line 378
  records that "Recurring billing and dunning are **not separate backlog entries**" and names
  the ID there.
- **Dependencies**: P3-03 (charge retries), P3-04 (tax-correct invoices), P1-04
- **Files/modules affected**:
  - src/finance/services/dunning.service.ts (`processOverdueInvoices`, `processOne`)
  - src/finance/entities/dunning-attempt.entity.ts
  - src/shared/workers/dunning.worker.ts (`DunningWorker`)
  - src/finance/finance.constants.ts:121-122 (`INVOICE_OVERDUE`, `DUNNING_ESCALATED`)
- **Database changes**:
  - `FINANCE_DUNNING_ATTEMPTS` — migration `1788965263269-CreateFinanceDunningAttempts.ts`;
    one row per dispatched event, unique on (organization_id, invoice_id, attempt_number).
    The migration's own docblock records that payment retry counters stay on `Payment`.
- **API changes**: None new. Dunning is worker/notification-driven (plan §5 line 440); staff
  clear a dunned invoice through the existing `POST /v1/invoices/:id/payments`
  (`src/finance/controllers/payments.controller.ts:49`).
- **Frontend changes**: None
- **Worker changes**:
  - `DunningWorker` — `workerName: 'DUNNING'`, daily (24h) with a batch of 50
    (`src/shared/workers/worker-config.ts:23,38`), OFF by default behind `WORKERS_ENABLED`
    plus the `WORKERS_<NAME>_ENABLED` override documented in `.env.example`.
  - Complementary to the pre-existing `PAYMENT_RETRY` worker (15 min, batch 50): retry
    re-attempts a *pending payment*, dunning communicates and escalates.
- **Tests**:
  - src/finance/services/dunning.service.spec.ts
  - src/shared/workers/dunning.worker.spec.ts
- **Acceptance criteria**:
  - An overdue invoice publishes `InvoiceOverdue.v1` and records an attempt row
    (`dunning.service.ts:93-107`), with an existing-row lookup on (organization, invoice,
    `INVOICE_OVERDUE`) at `:79-80` preventing a duplicate dispatch
  - Once the latest failed payment's `retry_count` reaches
    `PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS`, escalation publishes `DunningEscalated.v1` with
    `attemptCount` (`dunning.service.ts:123-143`), guarded the same way at `:124-125`
  - The worker is a no-op unless enabled and its ticks never overlap or throw
- **Risks**: Worker infrastructure scaling (plan §5 line 464, §14.7); communication channels
  are P5 (Notifications) work (plan §5 line 463). **Unruled:** plan §15 Q14 owns the
  question of which component owns the max-attempts counter and whether the schedule is
  fixed or exponential — there is no `Decision` line, so two counters disagreeing remains an
  open design risk rather than a settled one.

### P3-09: Recurring Billing / Renewal
- **Objective**: Bill and renew memberships when `renewal_date` arrives — raise the renewal
  invoice, charge it, and extend `end_date` / `renewal_date` only once the charge succeeds.
  **Shipped in `e16c1118`.** This backlog entry was missing until 2026-09-30 (plan §5
  line 378).
- **Dependencies**: P3-04 (renewal invoices must carry tax — plan §5 line 461), P3-03 (the
  charge), P1-04
- **Files/modules affected**:
  - src/memberships/services/memberships.service.ts (`renew`, `renewDueMemberships`, `renewOne`)
  - src/shared/workers/membership-expiry.worker.ts (drives the renewal scan)
- **Database changes**: None — no migration was required. The path reads the Phase 1
  `renewal_date` / `price_at_signup` / `currency_at_signup` columns and writes
  `MEMBERSHIP_HISTORY` rows; `e16c1118` touched no migration file.
- **API changes**: None — renewal is service/worker-only. No membership controller
  references `renew` (`grep -rn 'renew' src/memberships/controllers/` → 0). Whether an
  operator-triggered route is required is `phase3-status-report.md` §6 Q8, still unruled.
- **Frontend changes**: None
- **Worker changes**:
  - No new worker. `MembershipExpiryWorker` calls `renewDueMemberships()` and then
    `expireDueMemberships()` in the same tick (`membership-expiry.worker.ts:34-45`),
    reusing the existing row-locked, exactly-once scan.
  - Plan §5 line 428 states a separate `RECURRING_BILLING` worker is needed only under
    option (a)/(c); none was built. Which option is *ruled* is plan §15 Q13, unrecorded.
- **Tests**:
  - src/memberships/services/memberships.service.spec.ts:370 (publishes `MembershipRenewed.v1`
    on the extending transaction), `:352` (a failed charge extends and publishes nothing),
    `:395` (no re-publish when the cycle was already settled)
  - src/memberships/services/memberships-discount-renewal.integration.spec.ts (real
    Postgres; reports SKIPPED unless `RUN_DB_INTEGRATION=1`)
- **Acceptance criteria**:
  - `end_date` and `renewal_date` advance only after the charge succeeds
  - `MembershipRenewed.v1` is written in the same transaction as the date extension and at
    most once per cycle (idempotency key `membership-renewal:{membershipId}:{renewalDate}`)
  - A failed charge leaves the membership unextended and publishes nothing
  - The renewal invoice reflects an in-force discount (P3-04b)
- **Risks**: Late payment versus expiry ordering — under the shipped option (b) a failed
  renewal is left to the expiry path (plan §5 lines 396-402), and no operator retry surface
  exists while `phase3-status-report.md` §6 Q8 is unruled.

### P3-10: Object Storage Configuration

- **Objective**: Close the Phase 3 storage-configuration gap — make `S3Module` reusable,
  document the S3 variables, and keep non-member object storage deferred. **Config shipped
  2026-10-01; key builders deferred** — the probes below record the state at filing
  (2026-09-30). Shipped: `@Global()` on `S3Module` (`b71decf3`), the three S3
  variables in `.env.example` (`387f706c`), and `uploads/` in `.gitignore` (`a38bead9`). Still
  absent: `buildCrmAttachmentKey()` / `buildInventoryImageKey()` — deferred until a consumer
  exists, exactly as this item scopes them.
  Filing-time probes: no `@Global()` (`grep -n 'Global' src/shared/storage/s3.module.ts` →
  none), no non-member key builders (`grep -rn 'buildCrmAttachmentKey\|buildInventoryImageKey' src` → none), and no
  S3 variables in `.env.example` (`grep -niE 'S3_LOCAL_ROOT|S3_DOCUMENTS_BUCKET|AWS_REGION'
  .env.example` → none). Scope per the owner decision (`docs/phase3-scoping-plan.md` §15.2).
- **Dependencies**: None — plan §10 line 829 records storage as "not a critical-path blocker".
- **Files/modules affected**:
  - src/shared/storage/s3.module.ts (`@Global()`)
  - .env.example (the three S3 variables)
  - .gitignore (`uploads/`)
  - src/shared/storage/s3.service.ts — **not** changed; the CRM/inventory key builders are
    deferred until a consumer exists (§15.2)
- **Database changes**: None.
- **API changes**: None.
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**: None new (config only).
- **Acceptance criteria** (owner decision, `docs/phase3-scoping-plan.md` §15.2; plan §10):
  - `S3Module` is annotated `@Global()` (plan §10 line 823)
  - `.env.example` documents `S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET`, `AWS_REGION`
    (plan §10 line 824)
  - `.gitignore` lists `uploads/` (§15.2)
  - No CRM/inventory key builders are added — deferred until a consumer exists (§15.2)
- **Risks**: None — config only. The CRM/inventory attachment features that would need new
  key builders are themselves descoped (§15.2).

### P3-11: PT Enrollment Cancellation & Commission Clawback

- **Objective**: Implement PT enrollment cancellation with an atomic commission clawback.
  **Shipped in `823c00d5`** — `git show --stat 823c00d5` ("feat(pt): add PT enrollment
  cancellation with atomic commission clawback") is 13 files, +251/−57: the cancel route and
  DTO, the PT-owned status transition, the enums, and the `TrainerCommissionClawedBack.v1`
  event doc.
- **Dependencies**: Phase 2 `TrainerCommission` (plan §6 line 470).
- **Files/modules affected**:
  - src/pt/controllers/pt-enrollments.controller.ts (`@Controller('v1/pt/enrollments')` `:14`;
    `@Post(':id/cancel')` `:18`; `@RequirePermissions({ resource: 'pt', action: 'delete' })` `:20`)
  - src/pt/dto/cancel-pt-enrollment.dto.ts
  - src/pt/services/pt-enrollments.service.ts (`cancel()` `:229`; the clawback write `:261`;
    the `TRAINER_COMMISSION_CLAWED_BACK` outbox write `:264`)
  - src/pt/entities/ — `trainer-commission.entity.ts`, `trainer-commission-status.enum.ts`,
    `pt-enrollment-status.enum.ts`
  - src/pt/pt.constants.ts:20 (`TRAINER_COMMISSION_CLAWED_BACK: 'TrainerCommissionClawedBack.v1'`)
- **Database changes**: None — **migration-free** (plan §6 line 508); the `clawed_back` state
  value was pre-deployed (`trainer-commission-status.enum.ts` docblock). `823c00d5` touched no
  migration file.
- **API changes**:
  - `POST /v1/pt/enrollments/{id}/cancel`, permission `pt:delete` (plan §6 line 525).
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - src/pt/services/pt-enrollments.service.spec.ts
  - src/pt/controllers/pt-enrollments.controller.spec.ts
- **Acceptance criteria** (plan §6 lines 492-494):
  - Cancelling transitions the enrollment to `CANCELLED` under the row lock
    (`pt-enrollments.service.ts:229`)
  - The linked commission is set to `clawed_back` in the **same transaction** (`:261`)
  - The clawback is PT-owned (single-write-path invariant) and publishes
    `TrainerCommissionClawedBack.v1` (`:264`)
  - Status transition only — no deletion (audit trail preserved)
- **Risks**: None material — migration-free, a single status transition.

### P3-12: PT Commission Payout Runs

- **Objective**: Add bulk commission payout runs with the `paid` transition. **Shipped in
  `fa8c5212`** — `git show --stat fa8c5212` ("feat(pt): add PT commission payout runs with the
  paid transition") is 20 files, +713/−11: the payout tables and permission migrations, the
  run/item entities, the payout service, the controller, `pt.events.ts`, and the `paid` status
  value.
- **Dependencies**: P3-11 (shared `TrainerCommissionStatus` lifecycle).
- **Files/modules affected**:
  - src/pt/entities/commission-payout-run.entity.ts (`PT_COMMISSION_PAYOUT_RUNS`)
  - src/pt/entities/commission-payout-item.entity.ts (`PT_COMMISSION_PAYOUT_ITEMS`)
  - src/pt/services/commission-payouts.service.ts (`create()` `:34`, `process()` `:120`)
  - src/pt/controllers/commission-payouts.controller.ts (`@Controller('v1/pt/commission-payouts')`
    `:6`; `@Post()` `:10`; `@Post(':id/process')` `:17`; `@Get(':id')` `:24`)
  - src/pt/entities/trainer-commission-status.enum.ts (`PAID = 'paid'`)
  - src/pt/pt.constants.ts:21 (`TRAINER_COMMISSION_PAID: 'TrainerCommissionPaid.v1'`)
  - packages/contracts/src/events/pt.events.ts
- **Database changes**:
  - `PT_COMMISSION_PAYOUT_RUNS` / `PT_COMMISSION_PAYOUT_ITEMS` — migration
    `1788965263270-CreatePtCommissionPayoutTables.ts` (net-new tables; the ERD has no payout
    concept — plan §6 lines 505-508).
  - `pt:payout` permission — migration `1788965263271-ProvisionPtPayoutPermission.ts`.
- **API changes**:
  - `POST /v1/pt/commission-payouts` — `pt:payout` (`commission-payouts.controller.ts:12`)
  - `POST /v1/pt/commission-payouts/{id}/process` — `pt:payout`
    (`commission-payouts.controller.ts:19`)
  - `GET /v1/pt/commission-payouts/{id}` — `pt:read` (`commission-payouts.controller.ts:26`)
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - src/pt/services/commission-payouts.service.spec.ts
  - src/pt/controllers/commission-payouts.controller.spec.ts
  - src/migrations/__specs__/1788965263270-CreatePtCommissionPayoutTables.spec.ts
  - src/migrations/__specs__/1788965263271-ProvisionPtPayoutPermission.spec.ts
- **Acceptance criteria** (plan §6 lines 498-499, 527):
  - A payout run snapshots the commission lines in scope and marks them `paid` on completion
    (`commission-payouts.service.ts:120`)
  - `paid` is added to `TRAINER_COMMISSION_STATUS_VALUES` — the additive option (plan §6
    line 499; `trainer-commission-status.enum.ts`)
  - Both payout routes require `pt:payout` (`commission-payouts.controller.ts:12,19`)
- **Risks**: The payout tables are net-new — "schema work is unavoidable for payout"
  (plan §6 line 508).

*2026-10-01: the five `implementation-roadmap.md` §Phase 3 frontend deliverables (inventory UI, CRM pipeline/lead management, advanced financial reports, trainer commission statements, refund/credit-note UI) are **descoped from Phase 3** — Phase 3 ships **API-only**. They are **unscheduled** (no target phase assigned) and no “Phase 3b” is created; deliberately **not** filed as backlog entries. Recorded by the owner, `docs/phase3-scoping-plan.md` §15.2.*

### P2-07: Measurements Tab API
- **Objective**: Implement API for body measurements tracking tab.
- **Dependencies**: P2-01
- **Files/modules affected**:
  - src/members/ (service for measurement data)
- **Database changes**:
  - measurement_logs table (new)
- **API changes**:
  - GET /v1/members/{memberId}/measurements
  - POST /v1/members/{memberId}/measurements
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Measurement validation (ranges, types)
  - Time series data storage
  - Aggregation for charts
- **Acceptance criteria**:
  - Stores weight, height, body fat, etc.
  - Time-stamped measurement records
  - Validates input ranges
  - Supports aggregation for trends
- **Risks**: Measurement fraud, inconsistent units

### P2-08: Loyalty Points and Transactions API
- **Objective**: Implement API for loyalty points balance and transaction history.
- **Dependencies**: P2-01
- **Files/modules affected**:
  - src/notifications/ or src/members/ (points service)
- **Database changes**:
  - loyalty_points table (member_id, balance)
  - loyalty_transactions table
- **API changes**:
  - GET /v1/members/{memberId}/points/balance
  - GET /v1/members/{memberId}/points/transactions
  - POST /v1/members/{memberId}/points/adjust (internal/admin)
- **Frontend changes**: None
- **Worker changes**:
  - Points calculation worker (for awarding points)
- **Tests**:
  - Points accrual for activities
  - Balance calculation accuracy
  - Transaction history completeness
  - Points expiration (if applicable)
- **Acceptance criteria**:
  - Shows current points balance
  - Lists earning and redemption transactions
  - Points awarded for configured activities
  - Balance updates in real-time
- **Risks**: Points inflation, incorrect accrual rules

### P2-09: Member 360 Tab UI with Lazy Loading
- **Objective**: Create Member 360 page with tabs and lazy loading.
- **Dependencies**: P2-01 through P2-08
- **Files/modules affected**:
  - apps/web/src/app/members/[id]/page.tsx (to create)
  - Individual tab components
  - Lazy loading wrappers
  - Shared UI components
- **Database changes**: None
- **API changes**: None
- **Frontend changes**:
  - Member 360 route layout
  - Tab navigation component
  - Individual tab components (Memberships, Services, PT, etc.)
  - Lazy loading for heavy tabs
  - Loading and error states
- **Worker changes**: None
- **Tests**:
  - E2E navigation between tabs
  - Lazy loading works correctly
  - Tab state preservation
  - Responsive design
- **Acceptance criteria**:
  - Member 360 page accessible
  - Tabs load content correctly
  - Lazy loading defers non-critical tabs
  - UI responsive and accessible
- **Risks**: Poor tab performance, UI inconsistency
  - Dates and plans correct
  - Pagination works
- **Risks**: Performance with long membership history

### P2-03: Services Tab API
- **Objective**: Implement API for service subscriptions tab.
- **Dependencies**: P2-01
- **Files/modules affected**:
  - src/scheduling/ (service for member enrollments)
- **Database changes**:
  - member_service_bookings table (if not in P1)
- **API changes**:
  - GET /v1/members/{memberId}/service-bookings
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Active service bookings retrieval
  - Past bookings inclusion
  - Service details population
- **Acceptance criteria**:
  - Lists current service subscriptions
  - Shows service details and schedule
  - Past bookings accessible
  - Filtering by status
- **Risks**: Missing service data, incorrect scheduling

### P2-04: Personal Training Tab API
- **Objective**: Implement API for personal training tab.
- **Dependencies**: P2-01
- **Files/modules affected**:
  - src/pt/ (service for member PT data)
- **Database changes**:
  - pt_enrollments table
  - pt_sessions table
  - workout_assignments table
  - workout_progress table
- **API changes**:
  - GET /v1/members/{memberId}/pt-enrollments
  - GET /v1/members/{memberId}/pt-sessions
  - GET /v1/members/{memberId}/workout-progress
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - PT enrollment data accuracy
  - Session history retrieval
  - Workout progress tracking
- **Acceptance criteria**:
  - Shows active PT enrollments
  - Lists past and future sessions
  - Shows workout assignments and progress
  - Session booking/cancellation history
- **Risks**: Incomplete PT data, progress tracking gaps
  - Branch settings configurable
  - Settings properly inherited/overridden
  - Changes audited
  - Default values provided
- **Risks**: Configuration drift, inconsistent settings

### P1-07: Member Search and Listing
- **Objective**: Implement efficient member search and listing with filtering.
- **Dependencies**: P1-01
- **Files/modules affected**:
  - src/members/ (service enhancements)
  - Database indexes for search
- **Database changes**:
  - Add indexes for member search (name, email, phone)
  - Consider pg_trgm for fuzzy matching
- **API changes**:
  - Enhance GET /v1/members with filtering parameters
  - Add search query parameter
  - Add sort parameters
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Search performance with indexes
  - Filter combinations work
  - Pagination correctness
  - Sorting options
- **Acceptance criteria**:
  - Members searchable by name, email, phone
  - Filtering works correctly
  - Pagination handles large result sets
  - Sorting by multiple fields
- **Risks**: Search performance degradation, incorrect results

### P1-08: Basic Web Shell and Dashboard
- **Objective**: Create basic Next.js shell with navigation and placeholder dashboard.
- **Dependencies**: P0-01, P0-04, P0-05 (for auth)
- **Files/modules affected**:
  - apps/web/ (pages, components, layout)
  - Next.js configuration
  - Auth integration with Next.js
- **Database changes**: None
- **API changes**: None
- **Frontend changes**:
  - Login page
  - Logout functionality
  - Main layout with navigation
  - Placeholder dashboard showing key metrics
  - Not-found page
- **Worker changes**: None
- **Tests**:
  - E2E login flow
  - Navigation between pages
  - Auth protection on routes
  - Responsive layout
- **Acceptance criteria**:
  - Users can log in and out
  - Protected routes require authentication
  - Basic navigation works
  - Dashboard placeholder shown
- **Risks**: Auth bypass, navigation issues
  - membership_plans table
  - memberships table
- **API changes**:
  - GET /v1/membership-plans
  - POST /v1/membership-plans
  - GET /v1/membership-plans/{id}
  - POST /v1/members/{memberId}/memberships
  - GET /v1/memberships/{id}
  - PATCH /v1/memberships/{id}
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Plan validation (price, duration)
  - Membership creation validation
  - Membership lifecycle checks
  - Concurrent sale prevention
- **Acceptance criteria**:
  - Plans created with pricing and billing cycle
  - Members can purchase memberships
  - Memberships tied to member and organization
  - Basic CRUD operations work
- **Risks**: Plan configuration errors, membership data inconsistency

### P1-03: Membership Lifecycle State Machine
- **Objective**: Implement membership state transitions (active, paused, cancelled, expired).
- **Dependencies**: P1-02
- **Files/modules affected**:
  - src/memberships/ (service for state transitions)
  - State machine logic (possibly using XState or custom)
  - Database already has status field
- **Database changes**:
  - membership_pauses table
  - membership_cancellations table
  - membership_extensions table
  - membership_transfers table
  - membership_discounts table
- **API changes**:
  - POST /v1/memberships/{id}/pause
  - POST /v1/memberships/{id}/resume
  - POST /v1/memberships/{id}/cancel
  - POST /v1/memberships/{id}/extend
  - POST /v1/memberships/{id}/transfer
  - POST /v1/memberships/{id}/discount
- **Frontend changes**: None
- **Worker changes**:
  - Membership expiry checker (to update statuses)
  - Payment retry worker (for failed renewal payments)
- **Tests**:
  - All state transitions valid
  - Invalid transitions prevented
  - Pause/resume calculations correct
  - Cancellation and refund handling
- **Acceptance criteria**:
  - Memberships transition through states correctly
  - Pause/resume maintains continuity
  - Cancellation stops future billing
  - Expiration handled automatically
- **Risks**: State corruption, missed transitions

### P1-04: Core Invoicing and Payment Processing
- **Objective**: Implement invoice creation and payment recording.
- **Dependencies**: P1-02, P1-03
- **Files/modules affected**:
  - src/finance/ (module, controller, service, dto, entity)
  - Invoice items, payments, allocations
- **Database changes**:
  - invoices table
  - invoice_items table
  - payments table
  - payment_allocations table
  - refunds table
  - credit_notes table
  - tax_lines table
  - financial_ledger table
- **API changes**:
  - GET /v1/invoices (paginated, filterable)
  - POST /v1/invoices
  - GET /v1/invoices/{id}
  - POST /v1/invoices/{id}/payments
  - GET /v1/payments (paginated)
  - GET /v1/payments/{id}
  - POST /v1/payments/{id}/refunds
  - GET /v1/financial-ledger (paginated)
- **Frontend changes**: None
- **Worker changes**:
  - Payment retry worker (Phase 1 stub)
  - Revenue recognition worker (deferred)
- **Tests**:
  - Invoice calculation (subtotal, tax, total)
  - Payment application to invoices
  - Partial payment handling
  - Refund and credit note logic
- **Acceptance criteria**:
  - Invoices generated correctly
  - Payments applied to invoices
  - Partial payments tracked
  - Refunds and credit notes issued
  - Financial ledger updated
- **Risks**: Financial inaccuracies, payment application errors
  - POST /v1/upload (presigned URL or direct)
  - POST /v1/files (metadata)
  - GET /v1/files/{id}
- **Frontend changes**: None
- **Worker changes**: 
  - Virus scanning worker (if async)
- **Tests**:
  - Upload success/failure
  - Virus detection and rejection
  - Metadata storage
  - Access control enforcement
- **Acceptance criteria**:
  - Files uploaded securely to S3
  - Virus scanning integrated
  - Access controlled (private by default)
  - Metadata stored and retrievable
- **Risks**: Upload bottlenecks, virus scanning false positives
- **Database changes**: None
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Cache get/set operations
  - Cache invalidation on data change
  - Cache stampede protection
  - Fallback to DB on cache miss
- **Acceptance criteria**:
  - Cache stores data with appropriate TTL
  - Cache invalidated when source data changes
  - Fallback to database when cache unavailable
  - Performance improvement demonstrated
- **Risks**: Cache inconsistency, memory overuse

### P0-08: Audit Logging
- **Objective**: Implement comprehensive audit logging for all tenant data changes.
- **Dependencies**: P0-03, P0-05
- **Files/modules affected**:
  - shared/audit-log/ (module, service)
  - Audit log entity
  - Database table
  - Audit interceptor or decorator
- **Database changes**:
  - shared.audit_log table
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Audit log creation for CREATE/UPDATE/DELETE
  - Audit log includes user and timestamp
  - Audit log contains changes diff
  - Audit log querying
- **Acceptance criteria**:
  - All tenant data changes logged
  - Audit logs include who, what, when
  - Logs tamper-evident (append-only)
  - Queryable by entity and time range
- **Risks**: Performance impact, log storage growth

### P0-09: CI/CD Pipeline Foundation
- **Objective**: Set up continuous integration and delivery pipeline with quality gates.
- **Dependencies**: P0-01
- **Files/modules affected**:
  - .github/workflows/ (CI yaml)
  - Dockerfiles for services
  - Scripts for linting, testing, building
  - Pre-commit hooks
- **Database changes**: None
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Pipeline runs on commit
  - Quality gates (lint, test, security)
  - Docker image builds successfully
  - Deployment scripts functional
- **Acceptance criteria**:
  - CI pipeline runs on every push
  - Automated testing on PRs
  - Secure artifact storage
  - Basic deployment automation
- **Risks**: Pipeline failures blocking development
  - Authentication guard and strategy
  - Token service
- **Database changes**:
  - users table
  - roles table
  - permissions table
  - user_roles junction table
  - role_permissions junction table
  - auth_tokens table
  - mfa_secrets table
- **API changes**:
  - POST /v1/auth/login
  - POST /v1/auth/logout
  - POST /v1/auth/refresh
  - POST /v1/users
  - GET /v1/users/{id}
  - PATCH /v1/users/{id}
  - POST /v1/users/{id}/mfa/enroll
  - POST /v1/users/{id}/mfa/verify
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Authentication flow unit tests
  - Permission checking tests
  - MFA enrollment and verification
  - Token expiration and refresh
- **Acceptance criteria**:
  - Users can register and log in
  - JWT tokens issued and validated
  - RBAC enforced on API endpoints
  - MFA works correctly
  - Password hashing secure
- **Risks**: Authentication vulnerabilities, token leakage
  - Event schema definitions (JSON Schema or similar)
- **Database changes**: None
- **API changes**: None (defines contracts for future APIs)
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - Schema validation tests
  - TypeScript type checking
  - Versioning compatibility tests
- **Acceptance criteria**:
  - Contracts package published and usable
  - Event schemas defined for core domains
  - TypeScript interfaces generated from schemas
  - Backward/forward compatibility tested
- **Risks**: Schema design mistakes requiring breaking changes later

### P0-03: Database Setup with Multi-tenancy *(RLS requirement withdrawn)*
- **Objective**: Configure PostgreSQL with multi-tenancy schema. Tenant isolation is enforced at the **application layer** — per-query `organization_id` predicates resolved from `TenantContextService` — not via PostgreSQL RLS. **RLS is formally deferred**; see `docs/database-plan.md`, "Tenant Isolation — Application-Layer Enforcement (RLS Deferred)", for the rationale (no per-request connection affinity, so the session GUC RLS policies depend on cannot be reliably populated; implementing it was estimated at 6–11 weeks) and the revisit triggers.
- **Dependencies**: P0-01
- **Files/modules affected**:
  - Database migration scripts
  - Shared database module
  - Tenancy module entities
- **Database changes**:
  - Create organizations table
  - Create branches table
  - Create shared tables: outbox, inbox, audit_log
  - Enable RLS on all tenant tables — **amended: withdrawn** (RLS deferred; isolation is the application-layer predicate, not a policy)
  - Add indexes for tenant queries
- **API changes**: None
- **Frontend changes**: None
- **Worker changes**: None
- **Tests**:
  - RLS policy testing (cross-tenant access blocked) — **amended:** there are no policies to test; the equivalent control is **cross-organization rejection tests at the service layer** (a spec asserting that another organization's row is rejected)
  - Migration script validity
  - Index effectiveness
- **Acceptance criteria**:
  - Database deployed with multi-tenancy support
  - RLS policies enforce tenant isolation — **amended:** tenant isolation is enforced by **application-layer scoping**, which was verified to be applied consistently across every checked service with zero exceptions found. This criterion is satisfied by the amended mechanism, not waived.
  - Migrations run successfully in dev/test
  - Basic CRUD operations work with tenant context
- **Risks**: RLS misconfiguration leading to data leaks — **no longer applicable** (RLS deferred). The residual risk under this ruling is that **a query written without an `organization_id` predicate has no database-level backstop**; the mitigations are code review and the scoped-service/`TenantContextService` pattern.

## Known Defects

### DEF-01: `QueryMembershipPlanDto.is_active` inverts `?is_active=false`
- **Objective**: Fix boolean query-parameter coercion on `GET /v1/membership-plans`.
  `@Type(() => Boolean)` calls `Boolean(value)`, and `Boolean('false')` is `true`, so
  `?is_active=false` filters for ACTIVE plans — the opposite of what was asked for —
  while still passing `@IsBoolean()`, so no 400 is raised and nothing reports a problem.
- **Found during**: P3-04 (tax handling), while writing `QueryTaxRateDto` and checking
  its `is_active` coercion against the rest of the codebase.
- **Dependencies**: None
- **Files/modules affected**:
  - src/memberships/dto/query-membership-plan.dto.ts (line 18 — the only production change)
  - src/memberships/dto/query-membership-plan.dto.spec.ts (new regression spec)
- **Database changes**: None
- **API changes**: None (behaviour fix only — `GET /v1/membership-plans?is_active=false`
  starts returning the plans it always claimed to)
- **Frontend changes**: None required today. The `apps/web` path is wired for
  `is_active` end-to-end but no call site passes it — see Blast radius.
- **Worker changes**: None
- **Reproduction**: `plainToInstance(QueryMembershipPlanDto, payload)` followed by
  `validate`, using the options `src/main.ts` sets (`whitelist: true, transform: true`),
  then asserting the transformed value:

  | `?is_active=` | after `@Type(() => Boolean)` | expected |
  | --- | --- | --- |
  | `true`  | `true`         | `true`    |
  | `false` | **`true`**     | `false`   |
  | `0`     | **`true`**     | `false`   |
  | `1`     | **`true`**     | `false`   |
  | `FALSE` | **`true`**     | `false`   |
  | (absent) | `undefined`   | `undefined` |

  Only the empty string coerces to `false` (`Boolean('')`), which is not a value a
  query parameter can meaningfully carry: the filter is effectively always true or
  unset, never false.
- **Fix**: use the form already established in this codebase —
  `@Transform(({ value }) => value === true || value === 'true')` — as used by
  `QueryInvoiceDto.outstanding_only`, `QueryAttendanceRecordsDto.open_only` and
  `QueryAccessDecisionsDto.is_granted`. `QueryTaxRateDto.is_active` was corrected this
  way during P3-04 and is the reference implementation.
- **Tests**:
  - `plainToInstance` + `validate` asserting `?is_active=false` transforms to `false`
    and stays distinguishable from an absent parameter
  - The string cases above pin the coercion, so the decorator cannot be reverted silently
  - Confirm `whitelist: true` still strips unknown query parameters
- **Acceptance criteria**:
  - `GET /v1/membership-plans?is_active=false` returns only inactive plans
  - `?is_active=true` and an absent parameter behave exactly as they do today
  - `@Type(() => Boolean)` no longer appears anywhere in `src/`
- **Blast radius** (verified 2026-09-19, at commit `eab95ced`): **no caller triggers
  this today**, but the frontend path is complete end-to-end, so the first filter
  feature added to the membership-plans screen would invert silently.
  - The entry point is HTTP only: `MembershipPlansService.findAll` is called from
    exactly one place, `MembershipPlansController.findAll`. No server-side caller
    constructs `is_active`, so nothing internal can reach this defect.
  - `apps/web` is wired the whole way: the type permits it
    (`QueryMembershipPlanParams.is_active?: boolean` in `lib/types.ts`), the API layer
    forwards it (`lib/memberships-api.ts`, `membershipPlansApi.list()` passes
    `is_active: params.is_active`), and the URL builder would emit it
    (`lib/api.ts`, `buildUrl`). Its guard is
    `value !== undefined && value !== null && value !== ''`, and `false !== ''` is
    `true` under strict comparison, so `false` is appended as `String(false)` — the
    literal `"false"`, which is exactly the input this defect mis-coerces. Verified by
    running that predicate directly: `{ a: undefined, b: null, c: '', d: false,
    e: true, f: 0 }` yields `"d=false&e=true&f=0"`.
  - The two live call sites both omit it, which is why the defect is unreachable now:
    `app/membership-plans/page.tsx` calls `useMembershipPlans({ page, limit })` and
    has no filter state at all (only `page` and `showCreate`), while
    `app/memberships/page.tsx` calls `useMembershipPlans({ limit: 200 })` and then
    filters the RESPONSE BODY client-side (`.filter((p) => p.is_active)`), which this
    DTO never touches.
  - Consequence: adding an "Active only" / "Show inactive" toggle to the
    membership-plans screen — a natural next step, since that table already renders
    Active/Inactive badges and its data contains both states — would return the
    opposite set with a `200 OK`, no error, no log, and no existing test to catch it.
    Land this fix before that feature, not after it.
  - Related: `app/memberships/page.tsx` fetches 200 plans unfiltered and filters in the
    browser. Migrating that to a server-side filter would work for `is_active: true`
    but break for the inactive case for as long as this defect stands.
- **Risks**: Low to fix and low to leave — but not zero. One decorator on one field, the
  current `is_active=false` behaviour is already wrong, so no correct caller depends on
  it, and there is no data to migrate. The exposure is forward-looking rather than
  current: the plumbing is wired and unused, so the cost is paid by whoever adds
  filtering rather than by anyone today (see Blast radius). A second
  `@Type(() => Boolean)` occurrence was the one this defect was found next to; it is

---

### DEF-02: Concurrent duplicate webhook delivery surfaces as an unhandled 500
- **Objective**: Map a `23505` on `FINANCE_WEBHOOK_EVENTS.provider_event_id` to the
  idempotent success path instead of letting a `QueryFailedError` reach the global filter.
- **Found during**: D14 security review, 2026-10-01 (`docs/phase3-security-review.md` F2).
- **Dependencies**: None.
- **Files/modules affected**: `src/finance/services/gateway-webhook.service.ts` (`receive`,
  the check-then-insert at `:30-36`); `src/finance/services/gateway-webhook.service.spec.ts`.
- **Database changes**: None. `UQ_finance_webhook_events_provider_event`
  (`1788965263260-AddPaymentGatewayAndWebhookEvents.ts:15`) is already the backstop.
- **Reproduction**: two concurrent `POST /v1/webhooks/payment-gateway` deliveries of the same
  signed event — both `findOne` calls miss, the second `save` raises 23505 → 500. The gate's
  `wh-05` covers only the sequential replay (201, one row).
- **Fix**: reuse the module's existing `isUniqueViolation` shape (as inventory does for
  `UQ_inventory_items_org_branch_sku`) so a duplicate insert returns `{ received: true }`.
- **Tests**: a unit case with a mocked 23505 on `save` → resolves `{received:true}` and no
  rethrow; the gate's `wh-05` stays green.
- **Acceptance criteria**: a duplicate delivery never returns 5xx; exactly one row per
  `provider_event_id`; Stripe does not retry on our behalf.
- **Risks**: Low. The unique index already guarantees correctness; this is response hygiene.

### DEF-03: `POST /v1/branches` returns 500 when `address`/`phone` are omitted
- **Objective**: Return a 400 (validation) rather than an unhandled NOT NULL violation.
- **Status**: **Fixed** — owner ruling (2026-10-03): both fields are REQUIRED by
  `CreateBranchDto` (`@IsNotEmpty()`, bounds matching the columns: address 500, phone 50), so the
  global `ValidationPipe` answers 400 and names the field. No migration, no nullable columns, no
  empty-string defaults. Pinned by `create-branch.dto.spec.ts` and the gate's `ten-04` (400/400/201).
  `POST /v1/organizations/:orgId/branches` shares the DTO and is fixed with it.
- **Found during**: D15 API gate bring-up, 2026-10-01 — the gate's own fixture hit it.
- **Dependencies**: None.
- **Files/modules affected**: `src/tenancy/dto/create-branch.dto.ts` (`address`/`phone` are
  `@IsOptional`), `src/tenancy/entities/branch.entity.ts:15-19` (both columns NOT NULL, no
  default), `src/tenancy/services/branches.service.ts` (`create`).
- **Database changes**: None. The columns stay `NOT NULL`; the DTO is what changes (ruled
  2026-10-03 — the "make the migration nullable" alternative was declined).
- **API changes**: `POST /v1/branches` with only `name`+`organization_id` currently 500s.
- **Reproduction**: `POST /v1/branches {organization_id, name}` → 500; adding `address` and
  `phone` → 201 (the existing frontend and `browser-verify.mjs` always send them, which is why
  it has gone unnoticed).
- **Tests**: a controller/DTO case pinning the chosen contract; the gate fixture already sends
  both fields.
- **Acceptance criteria**: an omitted field yields 400 with a message naming it, never a 500.
- **Risks**: Low; the shape is additive either way.

### DEF-04: Webhook rows carry no tenant attribution
- **Objective**: Populate `FINANCE_WEBHOOK_EVENTS.organization_id` (or drop the column as
  deliberately unused).
- **Found during**: D14 security review, 2026-10-01 (F3).
- **Files/modules affected**: `src/finance/services/gateway-webhook.service.ts:32-35` (the
  `create` payload); `src/finance/entities/webhook-event.entity.ts:22-23`.
- **Database changes**: None. The column already exists (nullable).
- **Reproduction**: `SELECT organization_id FROM "FINANCE_WEBHOOK_EVENTS"` → NULL for every row
  (the gate's `wh-04` writes one and the column stays NULL).
- **Fix**: derive the org from the referenced payment inside the processor's transaction (the
  receive path has no authorized tenant context by design), or drop the column.
- **Acceptance criteria**: every processed row names its tenant, or the column is gone.
- **Risks**: Low.

### DEF-05: Webhook events can be stuck in `processing`; `failed` is terminal
- **Objective**: Recover rows claimed by a crashed process and allow bounded retries.
- **Found during**: D14 security review, 2026-10-01 (F4).
- **Files/modules affected**: `src/finance/services/webhook-event.processor.ts:22-26,56`.
- **Database changes**: Possibly a `claimed_at`/lease column (a migration).
- **Reproduction**: kill the process between the claim UPDATE (`:22-23`) and the final save
  (`:56`); the row stays `processing` and no code path ever revisits it.
- **Fix**: lease pattern mirroring the outbox poller's (`OUTBOX_LOCK_DURATION_MS`), and a
  retry ceiling for `failed` before dead-lettering.
- **Acceptance criteria**: a crash-orphaned row is reclaimed; `failed` rows are retried a
  bounded number of times and then parked with their error.
- **Risks**: Medium — touches the claim query; keep `FOR UPDATE SKIP LOCKED` semantics.

### DEF-06: Outcome classification by substring, and an unscoped payment lookup
- **Objective**: Classify by an explicit allowlist of handled event types, and cross-check the
  payment's organization.
- **Found during**: D14 security review, 2026-10-01 (F5).
- **Files/modules affected**: `src/finance/services/webhook-event.processor.ts:41` (`type
  .includes('succeeded')`), `src/finance/services/payments.service.ts:443-446` (`findOne({ id })`).
- **Reproduction**: static — no signed event can currently reach a state these mis-handle;
  both are defence-in-depth gaps, not live bypasses.
- **Fix**: an explicit `handledEventTypes` map plus an org predicate derived from the payment
  row inside the existing transaction.
- **Acceptance criteria**: an unhandled event type is recorded but applies no state change.
- **Risks**: Low.

### DEF-07: No HTTP request throttling on unauthenticated endpoints
- **Objective**: Throttle `POST /v1/webhooks/payment-gateway` and the auth routes (at minimum
  `login` and `verify-mfa`).
- **Status**: **Fixed** — owner rulings Q1..Q12, 2026-10-03 (see "DEF-07 rulings" below).
  `@nestjs/throttler` (the one new dependency) with a Redis `ThrottlerStorage` over the existing
  client; per-route guards on the five unauthenticated endpoints only; 429 with `Retry-After`;
  `TRUST_PROXY` parsed and validated at boot; throttling fails **open** with a log line when
  Redis is unavailable. Pinned by the unit specs (`trust-proxy.spec.ts`,
  `throttle.config.spec.ts`), the gated real-Redis spec
  (`redis-throttler-storage.integration.spec.ts`) and the gate's `auth-04`..`auth-06`, `boot-03`
  and `wh-08`.
- **Accepted residual risks (owner, 2026-10-03)**: a distributed attack on one account is not
  blocked (no email-only counter, by ruling); `TRUST_PROXY` must be set behind any reverse proxy
  or every client shares one IP; authenticated routes stay unthrottled. All three are recorded
  under "DEF-07 rulings" below.
- **Found during**: D14 security review, 2026-10-01 (F6, out of D14 scope — app-wide).
- **Files/modules affected**: `src/main.ts` / `src/app.module.ts` (a global throttler guard);
  `@nestjs/throttler` is not a dependency today.
- **Database changes**: None (Redis is already available; the blacklist pattern exists).
- **Reproduction**: `grep -rniE 'throttler' src package.json` → nothing; rapid repeated
  login attempts all execute. Note the AI module DOES enforce per-organization usage limits in
  Redis (`src/ai/services/ai-usage-limit.service.ts`) — those are budget counters on AI
  endpoints, not HTTP request throttling, and they do not cover the webhook or auth routes.
- **Acceptance criteria**: a documented per-IP/per-tenant limit with 429 responses; the webhook
  limit must not drop legitimate Stripe retries (Stripe's own guidance applies).
- **Risks**: Medium — a careless limit can blackhole webhooks; the plan's own §"Rate limiting"
  (api-plan.md:27) is the intent to match.

### DEF-08: Webhook hardening residuals (Low)
- **Objective**: Bundle of low-severity hardening items recorded by the D14 review:
  (a) pass an explicit `tolerance` to `constructEvent` (`gateway-webhook.service.ts:28` relies
  on Stripe's 300 s default); (b) log rejections (the service logs nothing); (c) decide a
  retention/encryption policy for the raw `payload` jsonb; (d) decide whether provider tokens
  and `card_last4` in `FINANCE_PAYMENT_METHODS` should be encrypted with the existing
  `EncryptionService` (currently used only for MFA; Stripe tokens are not cardholder data, so
  this is defence-in-depth).
- **Found during**: D14 security review, 2026-10-01 (F7).
- **Acceptance criteria**: each sub-item is either implemented or explicitly waived with a
  one-line rationale in this entry.
- **Risks**: Low.
  already fixed, and the acceptance criterion covers it.

### DEF-09: Jest teardown leak — `A worker process has failed to exit gracefully`
- **Status**: **OPEN** — **CI-log measurement pending, owner decision on continuing the hunt
  pending.** Local evidence added 2026-10-04 (below); no fix attempted.
- **Objective**: Find and fix the root cause of the Jest teardown warning. A worker process
  keeps a handle open after the suite completes, so Jest prints
  `A worker process has failed to exit gracefully` and still exits 0. It is a leak, not a test
  failure, but it masks any future genuinely-stuck worker and holds up CI shutdown. It is
  **intermittent** — the 2026-10-02 re-measurement of the suite runtime did not reproduce it —
  so reproducing it reliably is the first task, and the handle that survives teardown the second.
- **Found during**: Phase 3 sign-off, 2026-10-02 (re-measuring the runtime recorded in
  `CLAUDE.md`; the warning did not appear in that run).
- **Local evidence (2026-10-04, the owner's 4-thread machine, load average 2–10)** — measured in
  local runs; the counts below are of RUNS, not of suites or tests:
  - full `npx jest` runs printed the warning in **3 of 6** runs — **2 of 5** once a cold-cache first
    run is excluded;
  - the runs that printed it were the slowest of the set;
  - `--detectOpenHandles`, run in-band, reported **zero** open handles;
  - subset bisection (`src/finance`; `src/shared` + `src/ai`; everything else) did not localise a
    source: **1** warning across **22** subset runs;
  - seen again on this branch (2026-10-04) during local jest runs in which every test passed.
- **What is still unmeasured**: whether CI (`.github/workflows/ci.yml`) prints the warning at all —
  its logs have not been read for it. That measurement, and whether to keep hunting, are the two
  open items.
- **Acceptance criteria**: either the leak is fixed and the warning stops appearing across N
  consecutive full runs, or the specific handle is identified and recorded here with a one-line
  rationale for leaving it open.
- **Risks**: Low — test-only; affects neither shipped behaviour nor the exit code.

### DEF-10: Extract `isUniqueViolation` into a shared util (Low)
- **Status**: **Fixed** — the census found **seven** copies, not the six this entry listed.
  `gateway-webhook.service.ts` was added by the `DEF-02` fix itself (the "one more place" that the
  ruling below deferred this refactor out of), and its own comment still called the pre-existing set
  "the six existing copies". All seven were semantically identical —
  `(driverError.code ?? code) === '23505'`, two of them spelling the same test across more lines —
  so all seven were replaced by one helper, `src/shared/utils/unique-violation.ts`.
- **What moved**: the test itself, and each copy's private `UNIQUE_VIOLATION_CODE` constant (six
  copies declared one; `refunds.service.ts` inlined the literal). Grep confirmed the helper was each
  constant's only reader and that no spec imported one, so the constants went with the copies
  rather than being left as dead code.
- **What did NOT move**: every call site kept its own outcome — a module's own 409 (`inventory`,
  `memberships`, `attendance`, `pt`) or an idempotent replay of the row the winner wrote
  (`payments`, `refunds`, `gateway-webhook`). The helper answers "was this a `23505`"; what a
  `23505` MEANS stays with the caller that knows which index its statement can collide on.
- **Evidence**: root `npm run typecheck` and `npm run lint` clean; the host modules' specs
  unchanged and green beside the new helper spec. Three mutants of the helper each typechecked and
  failed by ASSERTION, none by timeout: dropping the `driverError` candidate, changing the
  SQLSTATE, and **swapping the two candidate codes**. The swap fails ONLY the new precedence test,
  which is the point — no host spec exercised an error carrying both codes, so the shared ordering
  was unpinned until this extraction pinned it.
- **Objective**: one shared implementation of the `23505` detector, replacing the private copies.
- **Found during**: the `DEF-02` hardening work, 2026-10-02.
- **Files/modules affected**: six private copies — `payments.service:90`, `refunds.service:83`,
  `inventory.service:221`, `attendance:666`, `pt/commission-payouts:173`, `memberships:973`.
- **Why not done inside `DEF-02`**: it is a cross-module refactor, so it is out of scope for a fix
  that only needs the detector in one more place (ruling 4).
- **Acceptance criteria**: one shared implementation, all callers switched, each caller's existing
  unique-violation test still green.
- **Risks**: Low — no behaviour change intended.

### DEF-11: `processBatch` iterated the `[rows, count]` tuple and never processed an event (High)
- **Objective**: Record that webhook events were claimed and never processed, and that the
  defect is fixed.
- **Found during**: DEF-05 hardening, 2026-10-02 — the first real-database test of
  `processBatch`, in `src/finance/services/webhook-event-lease.integration.spec.ts`.
- **Files/modules affected**: `src/finance/services/webhook-event.processor.ts` (`processBatch`).
- **Root cause**: TypeORM's `manager.query()` returns `[rows, affectedCount]` for an
  `UPDATE … RETURNING`, not the rows alone. The claim returned a two-element tuple, the loop
  iterated the tuple, and `event.id` was `undefined` on both elements — `processOne(undefined)`
  threw and the failure path hit `TypeORMError: Empty criteria(s) are not allowed for the
  update method`. Rows the claim moved to `'processing'` stayed there forever.
- **Why nothing caught it**: the mocked unit spec calls `processOne` directly and never exercises
  the claim; the `WEBHOOK` worker is OFF by default, so the D15 API gate — which drives the
  webhook over HTTP and asserts only that the row was persisted — never ran `processBatch` either.
- **Status**: **Fixed** — `processBatch` destructures the rows out of the tuple, and
  `src/finance/services/webhook-event-lease.integration.spec.ts` is the regression guard: reverting
  the destructure fails 10 of the 16 lease tests (the number at the time of measurement,
  2026-10-02).
- **Acceptance criteria**: `processBatch` processes a claimed row end to end; the real-DB spec
  above is the regression guard, and moving the increment or the destructure fails it.
- **Risks**: High before the fix — a delivery was accepted (201), persisted, and then never
  applied, so gateway-driven payment and refund state transitions did not happen. The event rows
  accumulated in `'processing'`, which is the symptom `DEF-05` was filed to explain.

### DEF-12: A worker running longer than the lease can be reclaimed mid-processing (Medium)
- **Status**: **Mitigation asserted and pinned; the race remains; fencing filed as `DEF-18`** (owner
  ruling 2026-10-04, verbatim below). The mitigation is stated at the code that provides it and
  covered by tests; the structural fix is filed, with the trigger that unparks it.
- **Owner ruling (2026-10-04, verbatim)**: "DEF-12: retain the existing guards per path and file
  fencing-token work for when the webhook worker is enabled."
- **Objective**: Record the residual race the DEF-05 lease introduces, and the assumption it rests
  on, rather than leave it implicit.
- **Found during**: DEF-05 hardening, 2026-10-02.
- **Files/modules affected**: `src/finance/services/webhook-event.processor.ts` (`processBatch`,
  `processOne`); `src/shared/workers/worker-config.ts` (`WEBHOOK_LOCK_DURATION_MS`).
- **Mechanism**: the claim sets `locked_at = now()` and takes the row. If the batch's work for a
  row runs longer than `WEBHOOK_LOCK_DURATION_MS` (60 s per ruling #9) — a slow gateway call, a
  stalled database, a suspended host — the next poll's claim can take the same row while the first
  claimant is still working. Both then run `processOne` concurrently.
- **Why it is Medium and not High**: the second application is a no-op because the guards below the
  claim hold. **Corrected 2026-10-04:** this bullet originally called
  `PaymentsService.applyGatewayOutcome`'s `PENDING` early return "the entire mitigation". Measured by
  code read, that guard is a SECOND line, behind the row lock and the `processed` early return in
  `processOne`; which line actually carries the race is now measured too (see the design note). The
  refund path this bullet named was deleted with the branch that called it (`DEF-14`, 2026-10-04), so
  payments is the only side-effect path that still needs a guard — and the only one with one.
- **Not fixed here**: the lease is a timeout, not a fencing token — a reclaimable row has no
  monotonic claim id for the writer to check. Fencing (or extending the lease while work is in
  flight) is the structural fix and is out of scope for this pass.
- **Acceptance criteria**: either the mitigation is stated at the guard that provides it and
  covered by a test per side-effect path, or fencing is implemented. **Satisfied 2026-10-04 by the
  first branch** for the one side-effect path that remains (payments, after `DEF-14`); fencing is
  filed as `DEF-18`.
- **Risks**: Medium — silent duplicate application if a future consumer path is not idempotent.
  The lease duration is the tunable that trades this against recovery latency.
- **Design note (2026-10-04) — RULED the same day: option (3) is implemented, option (1) is filed as
  `DEF-18`.** The paragraphs below are kept as the record of what was weighed; the two line numbers
  inside them that had drifted are corrected in place, dated.
  - **Current behaviour, with file:line**: `processBatch` claims with
    `SET status='processing', locked_at=now(), attempts=attempts+1 … WHERE (locked_at IS NULL OR
    locked_at < now() - ($3 ms))` (`webhook-event.processor.ts:85-103`), `$3` being
    `WEBHOOK_LOCK_DURATION_MS = 60_000` (`worker-config.ts:56`). Each claimed row then runs
    `processOne` (`:104-107`, `:127-172`) in ONE transaction holding a `pessimistic_write` lock on
    the event row (`:129`). Two guards sit below that lock: `processOne` returns early when the row
    is already `processed` (`:131` — the note as first written said `:130`; re-derived by grep
    2026-10-04), and each side-effect path carries its own state guard — `payments.service.ts:436`
    (`status !== PENDING` → return; the note as first written said `:448`) and, until `DEF-14`
    deleted it on 2026-10-04, `refunds.service.ts:230` (`!refund || !succeeded || status !==
    PENDING` → return; the note as first written said `:234`).
  - **Failure scenario, concretely**: (1) the claim moves event E to `processing` with a fresh
    `locked_at`; (2) the batch's work for E stalls past 60 s — a slow gateway call, a stalled
    database, a suspended host; (3) the next poll's claim matches E again, its lease having lapsed
    and `attempts < MAX_ATTEMPTS`, and takes it; (4) both claimants now run `processOne` for E.
  - **Is it reachable today? NO** — MEASURED by code read: the `WEBHOOK` worker is OFF by default
    (`WORKERS_ENABLED`, `worker-config.ts`), so in every shipped configuration nothing claims a row
    at all. Reachability begins when the worker is enabled, which the standing ruling already gates
    on one real test-mode payment through the gateway adapter.
  - **How far the two claimants actually collide** — **MEASURED 2026-10-04** by the tests added for
    this entry, not inferred: with a claimant holding the row inside its transaction and the lease
    already past, a second claimant's real `processBatch` does not claim the row at all — the claim's
    `FOR UPDATE SKIP LOCKED` passes over it — and a second `processOne` blocks on the row lock until
    the first commits, then returns at the `processed` early return (`:131`; the note as first
    written said `:130`). The `applyGatewayOutcome` state guard is therefore a SECOND line behind
    both, rather than — as this entry's original wording has it — "the entire mitigation". The lock
    serialisation assumes both claimants run against the same database under READ COMMITTED (the only
    configuration tested).
  - **Mutation matrix (2026-10-04)** — each mutant typechecked (root `npm run typecheck`, EXIT=0) and
    was run against the real-DB spec with `RUN_DB_INTEGRATION=1` on a migrated throwaway database,
    plus its hermetic sibling. Every kill was by ASSERTION, none by timeout:

    | mutant | real-DB spec (`RUN_DB_INTEGRATION=1`) | hermetic sibling |
    |---|---|---|
    | `payments.service.ts:436` — remove the `PENDING` early return | **2 failed, 18 passed**: "does not double-apply a payment that is already succeeded" + "leaves a payment untouched when the same gateway outcome is applied a second time (DEF-12)" | `payments.service.spec.ts`: 13 passed — a mocked repository cannot see the guard |
    | `webhook-event.processor.ts:131` — remove the `processed` early return | **1 failed, 19 passed**: "applies a payment exactly once when two claimants run processOne concurrently (DEF-12)" | `webhook-event.processor.spec.ts`: 1 failed, 5 passed — the duplicate-delivery test |
    | `webhook-event.processor.ts:130` — remove the row lock | **2 failed, 18 passed**: both DEF-12 claimant tests | 6 passed — invisible to mocks |

    Which guard is individually load-bearing: the row lock and the `processed` early return each
    independently stop the concurrent duplicate (removing either fails the two-claimant test), and
    the `PENDING` guard independently stops a second application on a settled payment. No mutant
    survived.

    **Note (2026-10-04):** the row-lock mutant's first run failed one DEF-12 test by per-test TIMEOUT
    rather than by assertion — the second claimant blocked on the payment stub the test uses to hold
    the first claimant open, a deadlock the assertion could not report. The test was reworked to
    release and join both claimants before asserting; the numbers above are from the re-run, in which
    both failures are assertions.
  - **Options**:
    1. **Fencing token** — a monotonic claim id on the row that the writer re-checks before it
       commits. **This needs a migration**: `FINANCE_WEBHOOK_EVENTS` has no such column
       (`webhook-event.entity.ts:1-44`) and `synchronize` is hard-disabled in both `app.module.ts`
       and `data-source.ts`, so schema changes are migration-only. Cost: medium — the claim SQL, the
       entity, a migration, and a token check on each side-effect path.
    2. **Lease heartbeat** — extend `locked_at` while work is in flight. No migration. Cost:
       low-medium; a hard-stalled host still loses its lease, so it narrows the window rather than
       closing it.
    3. **Assert the existing guards** — the entry's own first acceptance branch: state the
       mitigation at each guard that provides it and add one test per side-effect path. Cost: low,
       no migration, behaviour-preserving; does not remove the race.
  - **RECOMMENDATION (adopted by the 2026-10-04 ruling)**: **(3) now, (1) when the webhook worker is
    next scheduled to be enabled.** (3) is the entry's own acceptance criterion and pins the property
    that actually protects the money path today. (1) is the structural fix, and it should ride with
    the change that turns the worker on, where its migration cost is paid once. **(3) is implemented
    (tests below); (1) is filed as `DEF-18`.**

### DEF-13: Add `organizationId` to PaymentIntent and refund metadata (Low)
- **Status**: **Fixed** (owner ruling 2026-10-04, verbatim below). **Scope:** PaymentIntent metadata
  only. Refund metadata is deliberately left out, and the refund path that would have read it was
  deleted under `DEF-14` the same day.
- **Owner ruling (2026-10-04, verbatim)**: "DEF-13: park and log organization mismatches, tolerate
  missing metadata permanently, and leave refunds out."
- **Owner statement recorded with the ruling (2026-10-04, verbatim)**: "No real payment data or
  pending payment is in flight anywhere."
- **Objective**: Add `organizationId` to PaymentIntent and refund metadata at creation, and
  cross-check it in the processor. (Refund metadata is out of scope per the ruling above.)
- **Blocked on** (was): confirming whether payment retries reuse `payment.idempotency_key`, since
  Stripe rejects a key reused with different parameters. **Answered 2026-10-04 by code read: yes** —
  a retry reaches `StripePaymentGatewayAdapter.charge()`'s `{ idempotencyKey: payment.idempotency_key }`
  with the key unchanged (`payment-retry.service.ts` → `payments.service.ts`
  `applyRetryOutcome`/`applyGatewayOutcome`; that line was `:41` before this change added the metadata
  field and its comment, `:49` after).
  Moot in any case given the owner statement above, and the hazard it implies is recorded below.
- **Shipped behaviour** — `stripe-payment-gateway.adapter.ts` writes
  `metadata: { paymentId, organizationId }`; the processor cross-checks it in `processOne`'s payment
  branch before applying anything: equal → applied; **absent → applied with a warn-level log**
  (tolerated permanently: pre-DEF-13 payments carry none, and a non-string or empty value reads as
  absent); **present and different → the event is parked `dead_lettered`** with an `error_message`
  naming both organization ids, logged at error level with the event and payment ids, and the payment
  is left untouched. The idempotency key is unchanged.
- **Implementation choice, not a ruling (RECOMMENDATION)**: the park is written directly by
  `processOne` — the same `dead_lettered` state and `error_message` column the claim's own `parked`
  sweep writes — rather than by failing the event and letting it retry to the ceiling. A mismatch is
  not transient: retrying would not change the outcome and would re-attempt nothing five times over.
  The claim's sweep remains the only writer for abandoned rows.
- **Ship hazard (recorded with the ruling).** Retries reuse `payment.idempotency_key` and Stripe
  refuses a reused key whose body differs, so **any environment holding PENDING payments created
  before this change must drain them before deploying it** — a retry of such a payment would send
  `{ paymentId, organizationId }` where the original request sent `{ paymentId }`. The owner states
  no such payment is in flight anywhere, so no drain is expected; this is a precondition to check,
  not a defect.
- **UNKNOWN**: whether Stripe accepts and echoes the added metadata. Nothing in the repository can
  observe that; it is settled by the owner's own real test-mode payment.
- **Mutation matrix (2026-10-04)** — each mutant typechecked (root `npm run typecheck`, EXIT=0) and
  every kill was by ASSERTION:

  | mutant | hermetic `webhook-event.processor.spec.ts` | real-DB spec (`RUN_DB_INTEGRATION=1`) |
  |---|---|---|
  | skip the cross-check (delete the mismatch block) | **1 failed, 8 passed** — the mismatch test | **1 failed, 20 passed** — the mismatch test |
  | compare against the wrong field (`!== paymentId`) | **1 failed, 8 passed** — the EQUAL test | 21 passed — does not discriminate this mutant |
  | park but still apply (drop the `return`) | **1 failed, 8 passed** — the mismatch test | **1 failed, 20 passed** — the mismatch test |

  No mutant survived. The wrong-field mutant is killed only by the hermetic equal-metadata test: the
  real-DB spec carries no fixture whose metadata matches the row, which is the gap that test covers.
- **Rationale**: defence in depth against our own cross-tenant bugs; signed payloads cannot be
  forged without our Stripe secret key.
- **Risks**: Low.

### DEF-14: The webhook refund path (`refundId` in event metadata) is unreachable today (Low)
- **Status**: **Fixed — the branch and its fixtures are deleted** (owner ruling 2026-10-04, recorded
  verbatim below; it supersedes the 2026-10-02 ruling this entry carried until then). The declined
  alternatives were the design note's own recommended option 3 — re-key the branch on
  `refund.created` / `refund.updated` and leave it unreachable — and option 2, wiring refunds through
  the gateway adapter, which cannot be completed without a real test-mode Stripe call. Pinned by
  `webhook-event.processor.spec.ts` and `webhook-event-lease.integration.spec.ts`: both assert a
  `charge.refunded` event is recorded `processed` with no state change, and re-adding the allowlist
  entry fails both (mutation run, 2026-10-04).
- **Owner ruling (2026-10-04, verbatim)**: "DEF-14: delete the unreachable refund branch and its
  fixtures."
- **Objective**: Record that the processor's refund branch cannot be reached by any event Stripe
  sends today, and what must change before gateway-created refunds are scheduled.
- **Found during**: the `DEF-02`/`DEF-04`/`DEF-05`/`DEF-06` hardening pass, 2026-10-02.
- **Files/modules affected**: `src/finance/services/stripe-payment-gateway.adapter.ts` (`refund()`),
  `src/finance/services/refunds.service.ts`, `src/finance/finance.module.ts`, the processor's
  refund fixtures; Stripe SDK 18.5.0 type files `types/EventTypes.d.ts` (`ChargeRefundedEvent`),
  `Charges.d.ts`, `Refunds.d.ts`. **Deletion sites, as implemented 2026-10-04** (line numbers as of
  `76e25ece`, all MEASURED by code read): `webhook-event.processor.ts:23-30` (the `charge.refunded`
  allowlist entry and the `kind` discriminator), `:134` (the `refundId` read), `:156-162` (the refund
  arm), `:7`, `:11`, `:50` (the `Refund` import, the `RefundsService` import, the constructor
  dependency); `refunds.service.ts:216-258` (`applyGatewayOutcome()`, no other production caller);
  `webhook-event.processor.spec.ts:83-95` and `webhook-event-lease.integration.spec.ts:428-451`
  (the two fixtures).
- **Root cause**: two independent gaps. (a) `StripePaymentGatewayAdapter.refund()` has no caller:
  `RefundsService` records staff-initiated refunds directly as `succeeded` and does not use
  `PAYMENT_GATEWAY` (`refunds.service.ts`, `finance.module.ts`), so no refund is created through
  the gateway for a webhook to report. (b) Even when one is, a `charge.refunded` event carries a
  `Charge`, whose own metadata is not the Refund's — the refund's metadata is under
  `object.refunds.data[n].metadata` (stripe SDK 18.5.0, `types/EventTypes.d.ts`
  `ChargeRefundedEvent`, `Charges.d.ts`, `Refunds.d.ts`). The `DEF-04` and `DEF-06` refund
  fixtures encode a shape Stripe does not send.
- **Why nothing caught it**: the path has no caller and the webhook worker is OFF by default, so
  nothing exercises it; the fixtures are hand-written, and no real test-mode refund event has been
  observed to contradict them.
- **Owner ruling (2026-10-02)**: the refund webhook path is documented, not changed.
  **Superseded 2026-10-04** — the ruling above deletes the branch instead, so this line is kept only
  as the record of why the deletion had not been done before that date.
- **When scheduled**: key on `refund.created` / `refund.updated` (object = `Refund`,
  `metadata.refundId`) and update the allowlist and fixtures. Needs an owner ruling when that work
  is scheduled.
- **Acceptance criteria**: the processor keys on the event types whose object actually carries the
  refund's metadata, and the refund fixtures match an event Stripe sends.
- **Risks**: Low — nothing shipped is affected today; the cost lands when gateway refunds are built
  on the current fixtures.
- **Design note (2026-10-04) — RULED; option 1 has since landed.** The paragraphs below were written
  while this entry awaited a ruling and are kept as the record of what was weighed, not as open
  questions. **What the ruling changed, measured by code read at `76e25ece`:** `'charge.refunded'` is
  gone from `HANDLED_EVENT_TYPES`; the refund arm of `processOne` is gone; the `kind` discriminator
  went with it, since after the deletion it had exactly one value; and
  `RefundsService.applyGatewayOutcome()` — the arm's only production caller, with no spec of its own —
  is gone too, together with the processor's `Refund` import and its `RefundsService` dependency. A
  `charge.refunded` event now takes the non-allowlisted path: logged as not handled, recorded
  `processed`, no attribution, no outbox write. **Kept:** `StripePaymentGatewayAdapter.refund()` and
  the `refund` member of `PaymentGatewayPort` — they are the gateway seam, not the unreachable branch.
  `refund()` still has **no caller** anywhere in production, and this entry is the record of that.
  The deleted transition's shape is recoverable from this entry's closing commit.
  - **Current behaviour, with file:line**: `'charge.refunded'` is an allowlisted handled type
    (`webhook-event.processor.ts:29`); `processOne` reads
    `const refundId = referenceId(object.metadata?.refundId)` from the event's `data.object`
    (`:134`), and when `handler.kind === 'refund' && refundId` calls
    `refunds.applyGatewayOutcome(...)` (`:156-162`). The object Stripe puts in a `charge.refunded`
    event is a **Charge**, so `object.metadata` is the Charge's metadata — for a
    PaymentIntent-created charge, the `{ paymentId }` the adapter set, never `{ refundId }`.
  - **Why the branch cannot fire** — two independent gaps, both MEASURED by code read:
    (a) `StripePaymentGatewayAdapter.refund()` (`stripe-payment-gateway.adapter.ts:53-68`) has no
    caller: `RefundsService` records staff-initiated refunds directly as `succeeded` and does not
    inject `PAYMENT_GATEWAY` (`refunds.service.ts:55`, `finance.module.ts:50`), so no refund is
    created at Stripe for a webhook to report; (b) even when one is, the reference this branch reads
    is not on the object Stripe sends. The `WEBHOOK` worker is additionally OFF by default.
  - **Fixtures encoding a shape Stripe never sends**: the hermetic `webhook-event.processor.spec.ts`
    refund test sets `event_type = 'charge.refunded'` and then **overwrites the Charge's metadata**
    with `{ refundId }` (`:83-95`); the real-DB `webhook-event-lease.integration.spec.ts` does the
    same through its payload builder (`:148-162`) and its refund fixture (`:430-441`). Both assert
    the processor routes a shape the provider does not produce.
  - **Options**:
    1. **Delete the unreachable branch and its fixtures** — drop `'charge.refunded'` from the
       allowlist, remove the refund arm of `processOne`, and delete or rewrite both fixtures. Cost:
       low. Consequence: removes dead code and a false assertion; the branch has to be re-added
       correctly when gateway refunds are built. **A standing owner ruling covers this entry** —
       "the refund webhook path is documented, not changed" (2026-10-02) — and deleting it IS a
       change, so this option needs a fresh ruling rather than being available by default.
    2. **Wire refunds through the gateway adapter** — `RefundsService.create` calls
       `PAYMENT_GATEWAY.refund()`, records the refund non-terminal, and lets the webhook confirm it.
       Cost: high. It changes the refund write path and its status semantics (a staff-recorded
       refund is `succeeded` immediately today), requires the allowlist and fixtures to be re-keyed,
       and cannot be completed without a real test-mode Stripe call — the owner's own task.
    3. **Re-key the branch correctly and leave it unreachable** — key on
       `refund.created` / `refund.updated` (object = `Refund`, `metadata.refundId`) and rewrite the
       fixtures to that shape. Cost: low-medium. Consequence: correct but still dead, and the
       allowlist would accept an event only a rewritten fixture produces.
  - **RECOMMENDATION (as written then)**: **(1), subject to a fresh owner ruling.** The entry's own
    "when scheduled" line already records the correct keying, so the knowledge survives deleting the
    code. If the 2026-10-02 ruling is meant to stand unchanged, **(3)** is the smallest change that
    stops two fixtures asserting a shape Stripe never sends. **The owner ruled (1) on 2026-10-04** —
    see the ruling at the top of this entry — and it is implemented.

### DEF-15: The token blacklist's fail-closed check can hang instead of refusing (Medium)
- **Status**: **Fixed** — owner ruling (2026-10-04): "fix DEF-15". One shared bounded-call helper
  (`src/shared/cache/bounded-cache-call.ts`) is applied at every request-path cache call, and each
  control keeps the answer it already had rather than acquiring a new one. Pinned by
  `src/shared/cache/bounded-cache-call.spec.ts` (hermetic: resolves, types the operation's own
  failure as a cache-unavailable error with the cause kept, refuses a millisecond early under fake
  timers, times out with a labelled message, refuses without a round trip when the client is not
  ready, refuses when the store exposes no client, swallows the promise it abandoned) and by
  `src/shared/auth/def-15-cache-hang.integration.spec.ts` (gated real-Redis, blackholed socket: the
  unbounded shape's `settled: false` — the reproduction — is shown in the tree by the raw-client
  CONTROL probe alongside its bounded counterpart, which settles; measured 2026-10-04).
- **Owner ruling O1 (2026-10-04, verbatim)**: "Use 503 Service Unavailable with Retry-After, not
  401, for infrastructure timeouts: Guard blacklist read, Refresh blacklist read, MFA replay claim,
  Blacklist writes. Keep the authentication path fail-closed, but do not represent a Redis
  infrastructure failure to the web client as an invalid user session."
  - **Why it matters on the web side (READ-ONLY inspection of `apps/web`, no code changed)**:
    `apps/web/src/lib/api.ts:151` runs its refresh-and-retry only when `res.status === 401`, and the
    `refreshAccessToken` it triggers calls `clearTokens()` on any non-ok refresh (`:130-133`). A 401
    for a Redis outage therefore ran a refresh that also failed and left the user signed out.
    Answering 503 skips that branch entirely and surfaces an `ApiError(503)` with the tokens intact.
  - **Per-site answer under O1.** "Infrastructure failure" means any of the four shapes the helper
    types as `CacheUnavailableError`: the deadline expiring, the store exposing no client, a client
    reporting `isReady === false`, or the driver rejecting the call.

    | # | Site | Before | After | `Retry-After` | Request |
    |---|---|---|---|---|---|
    | 1 | `jwt-auth.guard.ts` blacklist read — infrastructure failure | 401 | **503** | yes | stops |
    | 2 | `jwt-auth.guard.ts` blacklist read — token found blacklisted | 401 | 401 | no | stops |
    | 3 | `auth.service.ts` MFA claim `SET NX` — infrastructure failure | 401 | **503** | yes | stops |
    | 4 | `auth.service.ts` MFA claim `SET NX` — returns null (replay) | 401 | 401 | no | stops |
    | 5 | `auth.service.ts` refresh blacklist read — infrastructure failure | 401 | **503** | yes | stops |
    | 6 | `auth.service.ts` refresh blacklist read — token blacklisted | 401 | 401 | no | stops |
    | 7 | `auth.service.ts` `blacklistToken` write via `refreshToken` | unplanned 500 | **503** | yes | stops |
    | 8 | `auth.service.ts` `blacklistToken` write via `logout` (access token) | unplanned 500 | **503** | yes | stops |
    | 9 | `auth.service.ts` `blacklistToken` write via `logout` (refresh token) | unplanned 500 | **503** | yes | stops |
    | 10-13 | `ai-usage-limit.service.ts` `recordUsage` (4 counter calls) | best effort, logged, request continues | unchanged | no | continues |
    | 14-21 | `ai-usage-limit.service.ts` `assertRequestAllowed` (rate limit `INCR`/`EXPIRE`, budget `GET`/`SET NX`/re-`GET`) | 503 | 503 | **added** | stops |
    | 22 | `ai-usage-limit.service.ts` unconditional client check (new, R9) | *absent* — allowed unmetered when every limit was `0` | **503** | yes | stops |
    | — | `redis-throttler.storage.ts` (DEF-07) | fail OPEN, 429 + `Retry-After` | **unchanged** | its own | continues |

    Ordering is preserved at every write site: `refreshToken` still revokes the presented token
    BEFORE issuing the new pair, so a write timeout means no new tokens and no rotation; `logout`
    still revokes the access token before the refresh token, so a timeout on the first leaves the
    second un-attempted.
  - **How the header is emitted.** `ServiceUnavailableWithRetryException`
    (`src/shared/cache/cache-unavailable.exception.ts`) extends `ServiceUnavailableException` and
    carries `retryAfterSeconds`; `ServiceUnavailableRetryFilter`
    (`src/shared/cache/service-unavailable-retry.filter.ts`) sets `Retry-After` and then delegates
    to `BaseExceptionFilter`, so the status and body shape are Nest's own. The filter's position in
    `app.module.ts` is load-bearing and is the opposite of what it looks like: Nest REVERSES the
    filter list before matching (`@nestjs/core/router/router-exception-filters.js`,
    `setCustomFilters(filters.reverse())`) and takes the first match, so the LAST filter registered
    is the FIRST tried. Registered before `SentryGlobalFilter` (which is `@Catch()`), it would never
    run — measured, not assumed: with the two providers in that order the header came back `null`
    on a 503 whose body was otherwise perfect. Pinned over real HTTP with the real filter chain by
    `src/shared/cache/service-unavailable-retry.filter.spec.ts`.
  - **The `Retry-After` value is a RECOMMENDATION, not a ruling.** O1 ruled that the header is sent
    but did not fix its value; `CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS = 5` seconds is this change's
    choice. Extending the same header to the pre-existing AI-limit 503s (rows 14-21) reuses the one
    mechanism and is likewise a **RECOMMENDATION** — the owner has not ruled on it.
  - **R6 — the deadline is now bounded above as well as below.** `readCacheCallTimeout` accepts an
    integer in `[1, 10000]` (`CACHE_CALL_TIMEOUT_MS_MAX`); a value above the ceiling, `0`, a
    negative, a fraction or a non-numeric value fails the boot. A deadline longer than the outage it
    is meant to cut short bounds nothing. Documented in `.env.example`.
  - **R9 — the unconditional check.** `assertRequestAllowed` tests that the counter client is
    present and ready BEFORE the per-limit branches and without a round trip. Previously the only
    readiness checks lived inside the counter calls, and every one of those is skipped when its
    limit is `0` — `0` being the documented way to disable a limit — so an all-zero deployment
    reached Redis never and allowed requests through unmetered while Redis was down, contradicting
    the promise `.env.example` made. That sentence now holds in every configuration and says so.
    `recordUsage` is untouched and stays best-effort.
- **Objective**: Give the blacklist read the same bound the throttling storage now has, so a Redis
  outage refuses a token promptly instead of holding the request open.
- **Found during**: the `DEF-07` fail-open fix, 2026-10-03 — the blacklist was quoted as the
  counter-example to the storage's fail-open ruling (`redis-throttler.storage.ts`, class comment).
- **Files/modules affected**: `src/shared/auth/jwt-auth.guard.ts:58-68`, plus three call sites in
  `src/identity/services/auth.service.ts` (`:131-134`, `:238`, `:388` — detailed below). The webhook
  route is clear: `git grep -in "cache\|redis" -- src/finance/controllers/gateway-webhook.controller.ts
  src/finance/services` returns no matches (exit 1), and the route's only Redis touch is the
  throttler storage via `@ThrottleWebhook` (`gateway-webhook.controller.ts:15`) — **INFERRED** (not
  exercised end-to-end). The absence was re-checked on 2026-10-04 with the pattern proved against a
  known positive first (`src/identity/services/auth.service.ts`, which it matches): it still returns
  exit 1 for the webhook controller and all of `src/finance/services`, and exit 1 for the whole of
  `src/finance/`. **Added 2026-10-04**: `src/ai/services/ai-usage-limit.service.ts`, a non-auth
  control on the same client — per-site detail under "Widened 2026-10-04" below.
- **Root cause**: the guard awaits `this.cacheManager.get('blacklisted:' + token)` (`:60`) with no
  deadline and no readiness check. The cache is the same node-redis client the throttler storage
  uses, so it has the same driver behaviour: mid-outage the client is open but not ready
  (`isReady === false`), and `@redis/client` 1.6.1 QUEUES the command while reconnecting forever
  rather than rejecting it. **INFERRED for this call site** (not exercised end-to-end): the
  `catch` at `:62` that logs "failing closed" and throws the 401 cannot run while the promise is
  pending, so the guard would not return and the request would hang — "fails closed" only holds
  in the boot-time shape, where a never-connected client rejects immediately with
  `ClientClosedError`. The client-level behaviour is **verified**: the outage test in
  `redis-throttler-storage.integration.spec.ts` reproduces open-but-not-ready against real Redis
  and shows a command staying pending for the whole outage. **No longer INFERRED (2026-10-04)**:
  the guard itself is now driven through a blackholed socket against real Redis in
  `def-15-cache-hang.integration.spec.ts`, which before the fix reported the probe as never
  settling and now reports it answering within the deadline.
- **Same exposure at three more call sites** (`src/identity/services/auth.service.ts`; line numbers
  confirmed by `git grep -n "cacheManager\|redisClient"` on 2026-10-03, source-read only — each hang
  consequence is **INFERRED**, none exercised end-to-end):
  - `:131-134` — the verify-mfa challenge claim `redisClient.set(claimKey, JSON.stringify('true'),
    { PX, NX })` inside `verifyMfaAndLogin` (`:103-158`): no deadline, no `isReady` check, no
    `try/catch` (the method's only `catch` wraps the JWT verify at `:109-115`).
  - `:238` — the revocation read for refresh-token rotation inside `isTokenBlacklisted`
    (`:233-246`, called from `refreshToken` at `:184`): the `try/catch` only helps once the promise
    settles; a command queued on a not-ready client never reaches the `catch`.
  - `:388` — the blacklist write inside `blacklistToken` (`:378-389`): no `try/catch` in the method
    and none at its callers (`refreshToken` `:198`, `logout` `:215` and `:229`), so a rejection
    propagates to the caller and a queued command hangs.
- **Reachability**: `JwtAuthGuard` returns early for `@Public()` (`jwt-auth.guard.ts:32`), so the
  four public auth routes (login, register, refresh, verify-mfa) never reach its blacklist read —
  the guard read's exposure is the **authenticated** routes. On the public paths the exposure is
  the three `auth.service.ts` sites above. `login` (`:74-102`) and `registerUser` (`:39-49`) make
  no cache calls beyond the throttler (**INFERRED** from the same source-read; not exercised
  end-to-end).
- **Why nothing caught it**: the never-connected shape rejects in about a millisecond, so a
  reviewer testing "Redis down" with a fresh client sees exactly the intended fail-closed
  401 — the hanging shape needs a live connection to be dropped from under the client.
- **Fix (shipped 2026-10-04)**: one shared helper, `src/shared/cache/bounded-cache-call.ts`, doing
  what `RedisThrottlerStorage` did alone: resolve the raw client through the cache store, refuse
  the call outright when `isReady === false` (no round trip), then race it against
  `CACHE_CALL_TIMEOUT_MS` (tunable, default 500 ms, integer in `[1, 10000]`, documented in
  `.env.example`, a value outside that range fails the boot). It throws a typed, labelled
  `CacheUnavailableError` and leaves the outcome to the call site's EXISTING error path, so nothing
  silently became fail-open. The fail-closed DECISIONS are all unchanged; O1 (2026-10-04, above)
  changed how an infrastructure failure is REPORTED to the client — the blacklist read, the MFA
  claim and the blacklist write answer 503 + `Retry-After` instead of 401/500, and the AI limit
  check answers its existing 503 with the header added.
  `RedisThrottlerStorage` now races its `EVAL` through the same helper, so the tree holds one
  implementation of the deadline rather than two; its own variable, default, message and fail-open
  behaviour are untouched (DEF-07 Q11/Q12). The two deadlines are deliberately separate controls:
  the storage fails OPEN, these calls do not.
- **Widened 2026-10-04** — **scope widened by task instruction 2026-10-04; owner confirmation of
  the widening is not on record.** Line numbers re-derived by grep in that session, not carried
  over. The exposure is not auth-only. `src/ai/services/ai-usage-limit.service.ts` is
  a second, non-auth control on the same client, and every one of its counter calls awaited the
  client with no readiness check and no deadline:
  - `recordUsage` — `incrBy` and `expire` for the daily token and monthly cost counters. Already
    best-effort by design (its `catch` logs and the request continues), so it stays best-effort;
    the deadline only stops it holding the response path open. Consequence if left unbounded: a
    completed AI call whose response is never returned.
  - `assertRequestAllowed` — `incr`/`expire` for the per-minute counter and the `get` / `set NX` /
    `get` hydration in `readBudgetCounter`. The class documents FAIL CLOSED (503), and that is what
    a deadline failure now reaches, one deadline sooner. Consequence if left unbounded: an AI
    request that hangs instead of being refused.
  - Reachability: `AiUsageLimitService` is called by `RetentionController` and
    `PlanPerformanceController`, both authenticated routes; each call is preceded by
    `JwtAuthGuard`, so the guard's own bounded read runs first. The client-level behaviour is
    **measured** against real Redis in `def-15-cache-hang.integration.spec.ts`; the full request
    path through either controller is not exercised end-to-end — **INFERRED** for the HTTP answer.
- **Owner ruling recorded late (2026-10-04)**: the throttler's fail-open log limiter — at most one
  "Throttling storage unavailable" line per 30 s per process, with the failures it folded in riding
  as a count on the next line printed (`FAIL_OPEN_LOG_INTERVAL_MS`, shipped with `DEF-07` on
  2026-10-03) — is a deliberate decision, not an artifact of that fix. **KEEP IT.** Recorded here on
  the owner's instruction of 2026-10-04 ("The 30 s fail-open log limiter in the throttler is an
  OWNER RULING: keep it"), the day after the behaviour shipped, so this register does not read as
  if the decision were made when it was written down.
- **Acceptance criteria**: with Redis dropped mid-run, a request carrying a revoked token is
  refused within the deadline and one carrying a live token is decided — never held open past it.
  Under O1 the refusal is 503 + `Retry-After` for an infrastructure failure and 401 for a genuine
  revocation, and the written revocation is never reported as successful.
- **Risks**: Medium — the blacklist is a security control; the deadline must keep the fail-closed
  decision (the token is not accepted) and only change how fast it arrives and how it is reported
  (503 rather than 401, per O1).

### DEF-15 follow-ups

- **The DEF-07 throttler timing flake (PR #7) reproduces when the WHOLE spec file runs.** Measured
  2026-10-04: 20 of 100 fresh-process whole-file runs failed, 0 of 70 runs with `-t`. The mechanism
  is **not established**; a stale libuv loop-time effect is an **unproven inference** from that data,
  not a finding. `TIMER_JITTER_MS = 10` is unchanged (measured worst shortfall 1 ms as an integer,
  2.37 ms in truth), and the PR #7 assertions are untouched by this entry.
- **R8 — the web logout path clears local tokens even when the revocation POST fails: accepted risk
  (owner ruling F1, 2026-10-04).** Filed separately from DEF-15 (O3, 2026-10-04); the single
  authoritative record is `### R8` under DEF-16 below.

## Hardening pass rulings (owner, 2026-10-02)

Recorded verbatim. These govern the webhook hardening work — `DEF-02`, `DEF-04`, `DEF-05`,
`DEF-06` — delivered on branch `hardening/webhook-def-02-06`.

1. `DEF-04` populates `FINANCE_WEBHOOK_EVENTS.organization_id`; column stays nullable.
2. Events with no payment/refund reference may keep a NULL org.
3. `DEF-02`: a duplicate delivery returns `{received:true}` / 201 as now.
4. `DEF-02`: local private 23505 helper; extracting the shared `isUniqueViolation` is filed as `DEF-10`.
5. `DEF-06`: explicit allowlist of event types that change state; every other type is recorded as processed with no state change, logged; no new status value.
6. `DEF-06`: `applyGatewayOutcome` takes an explicit `organizationId`; update all callers including `payment-retry.service.ts`.
7. `DEF-06`: independent org source via PaymentIntent metadata if it exists today (check first); if not, STOP and ask for a ruling.
8. `DEF-05`: migration authorized (claimed_at, attempt counter, dead/parked status).
9. `DEF-05`: lease 60 s, 5 attempts, in a named config constant. These are tunable defaults, not measured values.
10. Unhandled event types are not failures and never count toward `DEF-05`'s attempt ceiling.
11. `processBatch` gets a real-DB test as part of `DEF-05`.
12. No concurrency case in `api:gate` for the `DEF-02` race; record the residual risk.
13. Hardening work goes on branch `hardening/webhook-def-02-06`, delivered by PR. No push to main.

**Note on ruling 8.** The implemented columns are named `attempts` and `locked_at`, and the
parked state is `status = 'dead_lettered'` — the owner chose the fifth status value over a
boolean, 2026-10-02. The migration is `1788965263272-AddWebhookEventLease`.

**Note on ruling 12.** The residual risk, recorded here as the ruling asks: `scripts/api-gate.js`
has no concurrency case, so the `DEF-02` duplicate-delivery race is covered only by the sequential
replay check (`wh-05`). A concurrent duplicate cannot be produced by that harness as it stands.

### Amendments (owner, 2026-10-02)

- **Ruling 6 is WITHDRAWN.** `applyGatewayOutcome` keeps its current signature; no `organizationId`
  parameter is added and no callers are updated.
- **Ruling 7 is resolved as option (b).** The organization is derived from the payment or refund
  row inside the processor's transaction — which is what `DEF-04` was implemented as. There is no
  independent source available today: the check ruling 7 asked for found that the PaymentIntent
  metadata carries only `paymentId` (`src/finance/services/stripe-payment-gateway.adapter.ts`, the
  `paymentIntents.create` call), so metadata alone cannot name a tenant.
- **`DEF-06`'s organization predicate is dropped**, because with ruling 6 withdrawn it would be
  circular: the predicate would have to be derived from the very row it is used to find. The
  independent-source work is deferred to `DEF-13`.

## DEF-07 rulings (owner, 2026-10-03)

Recorded verbatim. These govern the `DEF-07` throttling work, delivered on branch
`feat/def-07-throttling`.

- **Q1.** Throttle only `POST /v1/auth/register`, `/login`, `/refresh`, `/verify-mfa` and
  `POST /v1/webhooks/payment-gateway`. Authenticated routes are out of scope.
- **Q2.** Limits, all overridable by environment variable with documented defaults (every number is
  a tunable default, not a measured value): `login` 30 requests/min per IP AND 10 requests per
  15 min per (IP, email) pair; `register` 10/hour per IP; `refresh` 60/min per IP; `verify-mfa`
  20/min per IP. No email-only counter (it would let anyone block a victim); the residual risk (a
  distributed attack on one account) is recorded in the backlog.
- **Q3.** Storage is Redis on the existing client, with an atomic increment+expiry. Use
  `@nestjs/throttler` (state the version compatible with the installed `@nestjs/common`) as the
  ONLY new dependency; implement `ThrottlerStorage` on the existing Redis client; do not add a
  second package without asking.
- **Q4.** The 429 body is the default shape, plus a `Retry-After` header.
- **Q5.** `TRUST_PROXY` environment variable (unset = trust nothing; accept a hop count or a subnet
  list; validate on startup). Document that behind any reverse proxy it MUST be set, or every
  client shares one IP.
- **Q6.** The webhook gets a high per-IP ceiling only (600/min default, overridable). No failure
  counting. A validly signed event must never be rejected by anything except that ceiling.
- **Q7.** No Stripe IP allowlisting.
- **Q8.** No lockout and no account state; a throttled login returns 429.
- **Q9.** Limits come from environment variables; `api:gate` sets raised per-IP limits and runs its
  own throttle-probe checks; no code bypass.
- **Q10.** `GET /v1/health` is exempt.
- **Q11.** If Redis is unavailable throttling FAILS OPEN with a log line; first quote how the
  existing token blacklist behaves on Redis errors and say whether this is consistent.
- **Q12.** DEF-07 storage deadline: `THROTTLE_STORAGE_TIMEOUT_MS` default 500 ms. Basis: local-host
  measurement, 4.49M evals, 0 over 250 ms, worst 200 ms under 4 CPU hogs, p99.9 up to 97 ms under
  contention. Not measured: network RTT, HTTP path, production load. Revisit after a production
  fail-open-by-timeout rate is available; raise if the rate on a healthy Redis is above zero.

### Residual risks (owner, 2026-10-03)

- **A distributed attack on one account is not blocked.** `Q2` rules out an email-only counter
  (anyone could use it to lock a victim out), so only the (IP, email) pair and the per-IP ceilings
  apply; an attacker spread across many IPs can still make many attempts against one account.
- **`TRUST_PROXY` must be set behind any reverse proxy** (`Q5`). Unset, every client shares the
  proxy's IP and the per-IP limits collapse into one global limit.
- **Authenticated routes are unthrottled** (`Q1`). Only the five unauthenticated endpoints above
  are covered.

## ESLINT-002 — `apps/web` lint (2026-10-03)

**Status: DONE — lint green, and since 2026-10-04 it IS a CI gate.** Branch
`chore/web-eslint-flat-config`. `cd apps/web && npm run lint` → `EXIT=0`. Web lint was **not** a CI
gate when this entry was written — the D16 CI slice added it to the `web` job of
`.github/workflows/ci.yml` (recorded under "D16" at the end of this file). This is the lint half of
the D16 `ESLINT-002` item; the
web-build half was a truncated local `@next/swc-linux-x64-gnu` addon (53,261,824 B on disk, ELF
section headers declared at 143,142,856 B), fixed the same day by `npm ci` at the workspace root —
`next build` has run `EXIT=0` since.

**Root cause (reproduced, not inferred).** `eslint-config-next@16` ships a flat-config-native
export whose peer range is `eslint >=9`, but the installed pair was `eslint@10.10.0`. ESLint 10
requires a scope-manager API (`addGlobals`) that the config's plugin stack does not provide, so
every run died before linting anything:

```
TypeError: scopeManager.addGlobals is not a function
```

The old script (`next lint`) additionally passed options ESLint 10 removed (`useEslintrc`,
`extensions`) — the `⨯ ESLint: Invalid Options` line `next build` printed. Both symptoms have one
cause.

**Fix.** One version change — `eslint` `^10.10.0` → `^9.39.5` — plus a new flat config
`apps/web/eslint.config.mjs` (base `eslint-config-next`, native export, no compat shim) and
`"lint": "next lint"` → `"lint": "eslint ."`. `eslint-config-next` stays at `^16.3.5`: it already
accepted ESLint 9. Trials in a throwaway `/tmp` copy, 2026-10-03:

| Trial | Combination | Result |
|---|---|---|
| (i) | `eslint-config-next@16` + eslint 10, native flat | CRASH — `addGlobals is not a function`, no findings |
| (ii) | `eslint-config-next@15.5.25` + eslint 9, `core-web-vitals` + `typescript`, `FlatCompat` shim | works; 12 findings (4 error / 8 warn); needs two version changes, a shim, and an undeclared `@eslint/eslintrc` dep |
| **(chosen)** | `eslint-config-next@16` + eslint 9, native flat, base preset | works; 21 findings (0 error / 21 warn); one version change |

**Pre-existing findings — inventory (21 warnings, 0 errors; measured 2026-10-03 on this branch).**
None were fixed in this slice and none are silenced: 10 findings were **downgraded to `warn` with a
TODO in `eslint.config.mjs`** (the TODO's count is the 10 below), and the other 11 were already
`warn`-level in the preset.

- **10 × `react-hooks/set-state-in-effect`** — downgraded to `warn`, TODO; each needs a React
  data-flow refactor, not a lint edit: `settings` (×2), `ai-usage`, `membership-plans/[id]`,
  `memberships/[id]`, `plan-performance`, `retention-analysis`, `AuthGuard`, `MfaForm`, `Navbar`.
- 4 × `@next/next/no-location-assign-relative-destination` — `ai-usage`, `plan-performance`,
  `retention-analysis`, `settings`.
- 4 × `@next/next/no-html-link-for-pages` — `membership-plans/[id]`, `memberships/[id]`,
  `AuthLayout`, `Footer`.
- 2 × `react-hooks/exhaustive-deps` — `check-in`, `payments`.
- 1 × `@next/next/no-img-element` — `Sidebar`.

**Coverage gap (follow-up, not this slice).** The base preset enables the TypeScript parser but no
`@typescript-eslint` rules — an unused variable is not flagged. Escalating to
`eslint-config-next/typescript` and/or `core-web-vitals` is a separate change.

## DEF-16 — The web client ends the session when the refresh call cannot answer (2026-10-04)

**Status: FIXED, and on `main`.** The refresh path landed via PR #9 (merge commit `76757c73`,
2026-10-04) and became effective when the backend half landed via PR #8 (merge commit `5cbf8b56`,
the same day): with both on `main` the refresh route answers 503 for an unreachable cache instead of
401, so the client can tell an outage from a rejected token. The no-refresh-token case is fixed on
`fix/web-no-refresh-token-clears-session`. **`R8` is an accepted risk, not a defect** — see its own
entry below.

- **Objective**: stop the web client from reading an infrastructure failure on `POST /v1/auth/refresh`
  as "your session is invalid".
- **Owner rulings (owner, 2026-10-04)**, recorded as such:
  - **W1.** Fix the expired-access-token + Redis-down sign-out in a separate small web PR, not on PR #8.
  - **W2.** Include R8 (the logout `finally { clearTokens() }`) in the same PR. **Superseded by F1.**
  - **W3.** The session decides the web test setup after inspecting `apps/web`.
  - **F1 (supersedes W2).** R8 is **option A**: accept today's logout behaviour — tokens are always
    cleared locally and the user is sent to `/login` — and record it as an **accepted risk**. If the
    revocation POST fails, for example during a Redis outage, the server-side refresh token stays
    valid until it expires (up to 7 days by default). `Navbar.tsx`, `Sidebar.tsx`, `auth-api.ts`
    `logout` and any logout UI are deliberately left unchanged. No token is claimed to have been
    stolen; the risk is the validity window alone.
  - **F2.** Fix the no-stored-refresh-token case **in code**: when a 401 arrives and there is no
    stored refresh token, clear the local tokens so the user is treated as signed out.
  - **F3.** Merge order: PR #8 first, then PR #9. **Recorded fact, no blame:** the two landed about
    thirteen minutes apart in the opposite order — PR #9 merged at 10:57Z, PR #8 at 11:10Z. Between
    those two moments `main` carried a client that had been taught to expect a 503 the backend did
    not yet send, so the fix was inert there; both are on `main` now and neither change regressed
    the other.
  - This work serves the earlier ruling: "do not represent a Redis infrastructure failure to the web
    client as an invalid user session."
  - **Not ruled** — every item below marked RECOMMENDATION is this branch's choice, not an owner
    decision: which statuses count as "session rejected" versus "unavailable"; the network-error and
    429 classification; whether `ApiError` exposes `Retry-After`. (The exact logout behaviour was on
    this list until F1 ruled it.)
- **Files/modules affected**: `apps/web/src/lib/api.ts`; the web test setup
  (`apps/web/jest.config.js`, `apps/web/tsconfig.spec.json`) and `apps/web/src/lib/api.test.ts`.
- **Measured trace (root cause)** — measured 2026-10-04 with a throwaway harness over byte-identical
  `apps/web/src/lib/api.ts` + `token-store.ts`, printing the token store before and after:
  an expired access token is refused **401 by `JwtAuthGuard` before any Redis call**
  (`jwt-auth.guard.ts:44-49`, the blacklist read at `:60` is never reached), so the client refreshes;
  **the refresh call is the one that reaches Redis**. With Redis down the refresh route answers 503
  (401 before PR #8 merges). The old `refreshAccessToken` ran `if (!res.ok) { clearTokens(); return false; }`,
  so **both tokens were cleared** (`{"access":null,"refresh":null}`), `apiRequest` then threw the
  **stale original 401**, and `AuthGuard` redirected to `/login` because `isAuthenticated()` was false.
  A 503 on a route carrying a **still-valid** access token was already correct: `apiRequest` enters
  the refresh branch on `res.status === 401` only.
- **Fix**: `refreshAccessToken` returns a three-way result instead of a boolean, and `apiRequest`
  acts on the outcome rather than on the original response.
- **Behaviour table** (refresh path; RECOMMENDATION unless it restates a measured backend fact):

  | Refresh outcome | Status / failure | Tokens | `apiRequest` throws | User-visible |
  |---|---|---|---|---|
  | refreshed | 200 with a usable pair | replaced | — (retries the original request) | stays signed in |
  | rejected | **401 only** — invalid, expired, revoked, wrong type, or account gone (`auth.service.ts:175-193`) | **cleared** (unchanged) | the original 401 | redirected to `/login` |
  | unavailable | 5xx, 429, any other non-OK | **kept** | the refresh failure's status, not the stale 401 | stays signed in, error shown |
  | unavailable | no HTTP response (network/DNS/reset) | **kept** | `ApiError` with `status: 0` | stays signed in, error shown |
  | unavailable | 2xx with no usable token pair | **kept** | `ApiError` with the actual 2xx status | stays signed in, error shown |
  | rejected | no refresh token stored | **cleared** — the leftover access token goes too (before this change it was kept, leaving a session that 401'd on every request) | the original 401 | redirected to `/login` |

  Concurrent 401s share the single in-flight refresh and receive the **same** outcome; the shared
  promise is still cleared in `finally`, so the next 401 starts a fresh refresh.
- **`ApiError.retryAfter` (RECOMMENDATION)**: `parseError` now reads `Retry-After` in its delta-seconds
  form, so the 429 the throttler sends and the 503 a degraded auth backend sends both reach the caller.
  The HTTP-date form is deliberately not parsed and yields `undefined`.
- **Both halves are on `main`; the condition this entry was contingent on has been met.** PR #9
  (merge commit `76757c73`) and PR #8 (merge commit `5cbf8b56`) are both ancestors of `main`, so the
  refresh route now answers **503 with `Retry-After`** for an unreachable cache rather than 401, and
  the client keeps the session on that answer. The earlier caveat — that until PR #8 merged a Redis
  outage answered 401 and the defect therefore persisted — no longer applies and is removed rather
  than left to mislead a later reader. Measured on `5cbf8b56` (2026-10-04): the merge is an ancestor
  of `main`, and the tree CI ran on is the tree verified locally.
- **Test setup and its CI status**: `apps/web` had no unit runner (no `test` script; only
  `@playwright/test`) and, when this was written, none wired into CI either — superseded on
  2026-10-04 by the D16 slice (see the D16 entry at the end of this file); the toolchain below is
  unchanged. The new specs run from a dedicated
  `apps/web/jest.config.js` using `jest`/`ts-jest` already in the lockfile — no new dependency. They are
  named `*.test.ts`, **not** `*.spec.ts`, deliberately: the repository-root jest config uses
  `testMatch: ['**/*.spec.ts']` with `rootDir: '.'`, so a `*.spec.ts` under `apps/web` is collected by
  the backend `npx jest` run and fails there, because that run compiles with the repo-root
  `tsconfig.spec.json`, whose `lib` has no DOM (`TS2304: Cannot find name 'window'`). Both halves were
  measured on 2026-10-04. Making web tests a CI gate was a separate change, and `.github/workflows/ci.yml`
  was untouched by the DEF-16 work — it was the D16 slice that made them a gate.
- **D16 — the web tests are not collected by the ROOT job; they run in their own job**: the root
  `npx jest --passWithNoTests` matches `**/*.spec.ts` and the web specs are `*.test.ts` under
  `apps/web`, so the root run collects none of them — deliberately, for the tsconfig reason above.
  When this was written that also meant no CI job ran them at all; the D16 CI slice (2026-10-04)
  added a `web` job that runs `cd apps/web && npm run test`, the script the same slice added to
  `apps/web/package.json`.
- **Acceptance criteria**: with the backend unable to answer the refresh, the stored tokens survive and
  the caller sees the refresh failure rather than a 401; only a 401 from the refresh endpoint clears the
  session; a valid access token plus an unavailable route behaves exactly as before.
- **Risks**: Low–Medium. The classification is by status only, and the pre-PR-#8 401-for-infrastructure
  ambiguity that was the original residual is resolved now that both halves are on `main`. What
  remains is the accepted risk recorded under `### R8` below. (The former D16 gap — that nothing ran
  these web specs in CI — was closed on 2026-10-04 by the `web` job of the D16 CI slice, recorded in
  the D16 entry at the end of this file.)

### R8 — Logout clears the session even when the revocation call failed

- **Status: ACCEPTED RISK (owner ruling F1, 2026-10-04).** Option A was chosen: the local session is
  always ended, and the exposure is recorded rather than fixed.
- **The risk, stated precisely — no theft is claimed.** `apps/web/src/lib/auth-api.ts` `logout` is
  `try { return await api.post('/v1/auth/logout', …) } finally { clearTokens(); }`, so the stored
  tokens are cleared even when the revocation POST failed; `Navbar.tsx:76-82` and `Sidebar.tsx:204-213`
  each call `clearTokens()` in their own `catch` and then `router.push('/login')` unconditionally, so
  the user is returned to `/login` looking signed out either way. When that POST fails — for example
  during a Redis outage, where the revocation did **not** happen — the server-side refresh token stays
  valid until it expires, up to 7 days by default (`JWT_REFRESH_EXPIRATION`, `.env.example`). **The
  exposure is that validity window**, on an explicit sign-out. This is a separate path from DEF-16,
  which is the *automatic* refresh on an expired access token.
- **Why options B and C were declined** (recorded so the reasoning is not re-litigated): the
  alternative — keep the tokens on 5xx/429/network and show a retryable error — cannot be completed
  inside the files the web change is allowed to touch.
  - `POST /v1/auth/logout` is **not** `@Public()` — it runs through `JwtAuthGuard`, whose blacklist read
    is exactly what fails during a Redis outage. When this was written `main` answered **401** there
    (`auth.service.ts:244`, `jwt-auth.guard.ts:67`), indistinguishable from "your token is already
    invalid", so a status-only rule would have classified an outage as a rejected session and cleared
    it — the same defect DEF-16 fixes on the refresh path. (PR #8 has since made that answer **503**,
    which *is* distinguishable, so this is the weakest of the three reasons today.)
  - The two sign-out call sites are `Navbar.tsx:76-82` and `Sidebar.tsx:204-213`. Each already calls
    `clearTokens()` in its own `catch` and then `router.push('/login')` **unconditionally**, so changing
    `auth-api.ts` alone changes nothing observable.
  - Showing the error needs an error surface the chrome does not have. The repo's only error display is
    `Alert`, used inline in page content; the sign-out control is a Bootstrap `.dropdown-item`, and
    `bootstrap@5.3.8` `dropdown.js` defaults to `autoClose: true` and closes the menu on any click inside
    it (`clearMenus`, `:365-391`), so an `Alert` rendered inside the dropdown is never seen. Wiring it up
    means editing `Navbar.tsx`/`Sidebar.tsx`/`AppLayout.tsx` — outside this change's allowed file list —
    and choosing a layout/UX behaviour the owner has explicitly left unruled.
- **Owner ruling (F1, 2026-10-04) answered that question: accept it.** The tokens are cleared locally
  and the user goes to `/login`, whatever the server answered; `Navbar.tsx`, `Sidebar.tsx`,
  `auth-api.ts` `logout` and every logout UI stay exactly as they are.
- **Note**: DEF-16 is the automatic refresh on an expired access token; R8 is the explicit sign-out.
  They share only the shape "a non-OK response is treated as proof the session is dead".

## DEF-17 — `clearTokens()` leaves `gym.organizationId` behind (2026-10-04)

**Status: Fixed** — owner instruction (owner, 2026-10-04), recorded verbatim: "DEF-17: fix the one
line typo and bundle it with D16's web-test script." Filed on 2026-10-04 as a RECOMMENDATION out of
the `DEF-16` follow-up work; the fix ships on `chore/ci-slice-d16` (the D16 PR).

- **Objective**: record that the web client's sign-out does not clear the organization id it sends
  as `X-Organization-Id`, and that the two sign-out paths disagree about it.
- **Files/modules affected**: `apps/web/src/lib/token-store.ts` (`clearTokens`), whose key set is
  `gym.accessToken` + `gym.refreshToken` only; `apps/web/src/components/layout/Sidebar.tsx`, which
  clears the organization id explicitly on sign-out, and `apps/web/src/components/layout/Navbar.tsx`,
  which does not. The organization id is a separate key with its own accessors
  (`getOrganizationId` / `setOrganizationId`), so it is not covered by `clearTokens()`.
- **Why it matters**: on a shared device a stale organization id can outlive the session that set
  it, so the next account to sign in on that browser keeps sending the previous account's
  `X-Organization-Id` until something overwrites it.
- **Effect on the server of a mismatched `X-Organization-Id` — MEASURED by code read**: the header
  is only ever a *request*. `TenantContextInterceptor` records it as `requestedOrganizationId` and
  documents in its own header comment that it is "NOT treated as proof of authorization"
  (`src/shared/tenant/tenant-context.interceptor.ts:14-19`, `:40-45`). Every org-scoped operation
  then calls `requireOrganizationAccess`, which checks an ACTIVE membership of the **JWT's** user
  (`src/shared/tenant/tenant-context.service.ts:114-123`); a mismatch throws
  `ForbiddenException('Access to this organization is not allowed')` → **403**. A stale header is
  therefore refused rather than honoured, and is not a cross-tenant read. `AiUsageService`
  documents that it never reads the header at all (`ai-usage.service.ts:39-41`), and
  `InventoryService` documents the same require-then-use shape (`inventory.service.ts:34-40`).
- **What is UNKNOWN**: whether every org-scoped path in every module routes through
  `requireOrganizationAccess` before it uses the requested organization. That check is a convention,
  not a database-enforced backstop (RLS is deferred permanently), and this entry did not audit all
  call sites. What the user actually sees when a stale header produces the 403 was not measured
  either.
- **Risks**: Low for confidentiality — the server refuses. Low-Medium for usability: a signed-in
  session that 403s until the id is replaced is indistinguishable, to the user, from a broken
  account.
- **The fix (D16 slice, 2026-10-04)**: `Navbar.tsx`'s sign-out now calls `setOrganizationId(null)`
  after clearing the tokens — the single line the instruction asked for, mirroring `Sidebar.tsx`.
  The alternative in the RECOMMENDATION below — teaching `clearTokens()` itself to clear
  `gym.organizationId` — was **not** taken: `clearTokens()` has five call sites, three of them not
  sign-outs (measured list below), so that edit changes more behaviour than the two sign-out
  controls this entry is about, which the `DEF-16` ruling `F1` deliberately left alone.
- **Pinned by**: `apps/web` typecheck, lint and `next build`, plus the diff — **no unit test**. A
  test for this needs a React rendering/testing dependency the repo does not carry; adding one is
  not ruled, so the runtime behaviour (an actual click on "Sign out") is **UNKNOWN**, verified by
  inspection only.
- **Measured 2026-10-04 (grep over `apps/web/src`, after the fix)**: `clearTokens()` has five call
  sites — `auth-api.ts:39` (the logout `finally`), `api.ts:171` and `api.ts:195` (the two automatic
  "session rejected" paths `DEF-16 F2` added), `Sidebar.tsx:208` and `Navbar.tsx:87` (the two
  sign-out controls). Both sign-out controls now clear the stored organization id; the two automatic
  paths clear the tokens and leave the organization id in place.
- **RECOMMENDATION (not ruled)**: have `clearTokens()` clear `gym.organizationId` as well, so the
  automatic paths are covered too — declined for this slice as above; it stays the owner's call.
- **Acceptance criteria**: either the organization id is cleared with the tokens on every sign-out
  path, or the decision to keep it is recorded here with its rationale. Met for the two sign-out
  controls by the fix; the automatic session-rejection paths are the residue recorded above.

## D16 — CI pipeline slice (2026-10-04)

**Status: DONE — branch `chore/ci-slice-d16`, delivered by PR (this session does not merge).**

- **Owner ruling (owner, 2026-10-03), recorded verbatim**: "D16 CI slice: accept my scope as listed."
  The scope as listed: split CI into parallel backend, web and integration jobs; add the web build
  and lint; run the gated specs and api:gate against Postgres and Redis service containers on every
  PR (non-required at first) and on main; drop the `branches` filter on `pull_request` (stacked PRs
  currently get no CI); a Docker build in a main-only job after measuring it once; npm cache only, no
  secrets; branch protection last, in the GitHub UI.
- **Owner instruction (owner, 2026-10-04), recorded verbatim**: "DEF-17: fix the one line typo and
  bundle it with D16's web-test script." — shipped in this PR, see the DEF-17 entry above.

**Jobs as shipped** (`.github/workflows/ci.yml`; every job runs `actions/checkout@v4` +
`actions/setup-node@v4` with `cache: npm`, under `permissions: contents: read`, with no secret and no
`continue-on-error`):

| Job (check name) | Trigger | Steps | Services | Timeout |
|---|---|---|---|---|
| `ci (24)` | push to main, every PR | backend typecheck, backend lint, hermetic `npx jest --passWithNoTests` | none | 20 min |
| `web` | push to main, every PR | web typecheck, web lint, web tests (`cd apps/web && npm run test`), web build | none | 20 min |
| `integration` | push to main, every PR | generated env file → scratch database → migrations → `RUN_DB_INTEGRATION=1` specs → `api:gate` → drop the scratch database | `postgres:16-alpine`, `redis:7-alpine`, both health-checked | 30 min |
| `docker-image` | push to main **only** | `docker build --build-arg GIT_REVISION=${{ github.sha }}` (pushes nothing) | none | 30 min |

- The backend job keeps its id and matrix precisely so the check is still called `ci (24)`; its
  frontend typecheck step moved into the new `web` job — that split is the ruling's first line.
- `pull_request` now has **no** `branches` filter, so a PR whose base is another branch gets CI.
  Whether a real stacked PR then receives a run is **UNKNOWN** until one exists.
- `concurrency: ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`
  (RECOMMENDATION, not ruled): a superseded run on the same ref is cancelled — including a
  superseded run on `main`.
- **The integration job's environment file** is generated per run from `.env.example` plus the
  service values, with throwaway secrets (`openssl rand`), written to `$RUNNER_TEMP` outside the
  checkout. Two of its values are deliberately NOT the job's: `DB_DATABASE=gym_ci_dev` (a name that
  is never created and never opened — `api:gate` refuses to connect to the database this file names)
  and `REDIS_DATABASE=0` (the development index — `api:gate` refuses when its own scratch index, 15,
  equals the file's). The run's scratch database is `gym_ci_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}`,
  named inline on each step (`DB_DATABASE="gym_ci_…" npm run migration:run`) so the file's
  `gym_ci_dev` is never touched; teardown runs under `if: always()` and drops it `WITH (FORCE)`
  (PostgreSQL 13+). No `psql` is needed — create and drop use the `pg` client already in the
  dependency tree.
- **The stale comment is gone**: the backend-tests step no longer names a suite/test count (the one
  that had drifted to "70 suites / 700+ tests"); it now describes the isolation and points at the
  gated specs' job. The "Frontend ESLint (explicitly SKIPPED)" block went as well — web lint is a CI
  step now.
- **Docker measurement (2026-10-04, local cold build on this machine, nothing pushed)**:
  `BUILD_EXIT=0`, wall time **385 s**, image **613 MB** (`612627317` bytes). Under the ~10-minute
  guideline the RECOMMENDATION set, needs no secret (only `github.sha`), and runs on main only — so
  the job ships. Its duration on a GitHub runner is still **unmeasured**: `docker-image` is skipped
  on a PR, so the first push to `main` after the merge is what will exercise it.
- **Measured on the PR (2026-10-04, run `37221183483` on `68dbd55b`, three attempts — the opening
  run plus two `gh run rerun`s; every attempt green)**. These are run and job durations, not counts
  of suites or tests:

  | Attempt | Run wall clock | `ci (24)` | `web` | `integration` | `docker-image` |
  |---|---|---|---|---|---|
  | 1 (opened) | 2m54s | 1m51s | 2m24s | 2m50s | skipped (PR) |
  | 2 (rerun) | 2m53s | 2m48s | 2m36s | 2m47s | skipped (PR) |
  | 3 (rerun) | 2m59s | 2m55s | 2m21s | 2m49s | skipped (PR) |

  For comparison, the three most recent pushes to `main` before this slice ran in 1m29s–2m27s
  (`gh run list --branch main --limit 3`, read 2026-10-04), so the split held the wall clock in the
  same band while adding the web gates, the gated specs and `api:gate` to it. Re-measure these
  before turning any of the new checks into a required one.

**What CI covers now**: backend typecheck/lint/hermetic suite; web typecheck/lint/tests/build; the
`RUN_DB_INTEGRATION`-gated specs against real Postgres and real Redis; `api:gate` (boots the real
`src/main.ts` over HTTP on its own throwaway database); a production image build on main.

**What CI still does not cover**: browser/E2E driving (no Playwright run — `apps/web` keeps
`@playwright/test` as a dependency but nothing in CI uses it); the web specs inside the ROOT jest
run (they stay `*.test.ts`, uncollected there by design); any publish/deploy step (nothing is pushed
to a registry or an environment); and migrations against any database other than the job's own
throwaway ones.

### Branch protection (owner action, not done)

Nothing in this slice changes repository settings. On 2026-10-03 the protection endpoint answered
`404 Branch not protected` and the rulesets endpoint answered `[]` — **CI is advisory, not a gate**,
and a red check does not block a merge. When the owner turns protection on in the GitHub UI, the
check names available to require are, in the order this entry suggests:

1. `ci (24)` — the backend check, required first: it is the one with the longest history;
2. `web`;
3. `integration` — the ruling's "non-required at first" job;
4. `docker-image` — main-only, so it never reports on a PR at all.

Required checks should be turned on **last**, after the new jobs have run several times and their
durations are known.

## DEF-18 — Webhook lease fencing token (2026-10-04)

**Status: OPEN — filed, not scheduled.** Filed out of the `DEF-12` work under the owner ruling of
2026-10-04: "DEF-12: retain the existing guards per path and file fencing-token work for when the
webhook worker is enabled." Nothing was changed.

- **Objective**: replace the webhook event lease's timeout-only reclaim with a monotonic fencing
  token, so a claimant whose lease has lapsed cannot write after a later claimant has taken the row.
- **Why it exists**: `DEF-12` — the lease is a timeout, not a fence. The guards asserted under
  `DEF-12` make a duplicate application a no-op **today**, but they are per-path state checks, not a
  structural exclusion; a new side-effect path that is not idempotent reintroduces the silent
  duplicate `DEF-12` describes.
- **Needs a migration.** `FINANCE_WEBHOOK_EVENTS` has no monotonic claim column
  (`src/finance/entities/webhook-event.entity.ts`), and `synchronize` is hard-disabled in both
  `src/app.module.ts` and `src/data-source.ts`, so the column can only arrive through a migration.
  A migration file must also satisfy the TypeORM loader contract pinned by
  `src/migrations/__specs__/migration-loader.contract.spec.ts` (one exported class, no `export
  function` in the glob, 13-digit timestamp suffix).
- **Scope if taken**: a monotonic claim column incremented in the claim SQL
  (`WebhookEventProcessor.processBatch`), carried into `processOne` and re-checked before the
  transaction commits — plus the entity, the migration, and the read-back tests.
- **Trigger that unparks it**: the next time the `WEBHOOK` worker is scheduled to be enabled
  (`WORKERS_WEBHOOK_ENABLED` / `WORKERS_ENABLED`), where the migration cost is paid once. The worker
  is OFF in every shipped configuration (`src/shared/workers/worker-config.ts`), so nothing is
  exposed while this waits.
- **Alternative considered and not chosen**: a lease heartbeat — extending `locked_at` while work is
  in flight. No migration, but a hard-stalled host still loses its lease, so it narrows the window
  rather than closing it (`DEF-12`'s option 2).
- **Files/modules affected (if taken)**: `src/finance/services/webhook-event.processor.ts`,
  `src/finance/entities/webhook-event.entity.ts`, `src/migrations/`, and the real-DB spec
  `src/finance/services/webhook-event-lease.integration.spec.ts`.
- **Acceptance criteria**: a claimant that has lost its lease to a later claimant cannot commit a
  side-effect write; a real-Postgres test shows the second claimant's token wins and the first's
  write is refused, with no second outbox event.
- **Risks**: Low while the worker is off. The migration would be additive (a nullable or defaulted
  column), so it does not rewrite existing rows.
