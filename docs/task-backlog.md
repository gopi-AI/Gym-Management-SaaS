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
- **Found during**: D15 API gate bring-up, 2026-10-01 — the gate's own fixture hit it.
- **Dependencies**: None.
- **Files/modules affected**: `src/tenancy/dto/create-branch.dto.ts` (`address`/`phone` are
  `@IsOptional`), `src/tenancy/entities/branch.entity.ts:15-19` (both columns NOT NULL, no
  default), `src/tenancy/services/branches.service.ts` (`create`).
- **Database changes**: None (either make the DTO require them, or the migration nullable —
  an owner call).
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
- **Objective**: Find and fix the root cause of the Jest teardown warning. A worker process
  keeps a handle open after the suite completes, so Jest prints
  `A worker process has failed to exit gracefully` and still exits 0. It is a leak, not a test
  failure, but it masks any future genuinely-stuck worker and holds up CI shutdown. It is
  **intermittent** — the 2026-10-02 re-measurement of the suite runtime did not reproduce it —
  so reproducing it reliably is the first task, and the handle that survives teardown the second.
- **Found during**: Phase 3 sign-off, 2026-10-02 (re-measuring the runtime recorded in
  `CLAUDE.md`; the warning did not appear in that run).
- **Acceptance criteria**: either the leak is fixed and the warning stops appearing across N
  consecutive full runs, or the specific handle is identified and recorded here with a one-line
  rationale for leaving it open.
- **Risks**: Low — test-only; affects neither shipped behaviour nor the exit code.

### DEF-10: Extract `isUniqueViolation` into a shared util (Low)
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
  the destructure fails every test in it.
- **Acceptance criteria**: `processBatch` processes a claimed row end to end; the real-DB spec
  above is the regression guard, and moving the increment or the destructure fails it.
- **Risks**: High before the fix — a delivery was accepted (201), persisted, and then never
  applied, so gateway-driven payment and refund state transitions did not happen. The event rows
  accumulated in `'processing'`, which is the symptom `DEF-05` was filed to explain.

### DEF-12: A worker running longer than the lease can be reclaimed mid-processing (Medium)
- **Objective**: Record the residual race the DEF-05 lease introduces, and the assumption it rests
  on, rather than leave it implicit.
- **Found during**: DEF-05 hardening, 2026-10-02.
- **Files/modules affected**: `src/finance/services/webhook-event.processor.ts` (`processBatch`,
  `processOne`); `src/shared/workers/worker-config.ts` (`WEBHOOK_LOCK_DURATION_MS`).
- **Mechanism**: the claim sets `locked_at = now()` and takes the row. If the batch's work for a
  row runs longer than `WEBHOOK_LOCK_DURATION_MS` (60 s per ruling #9) — a slow gateway call, a
  stalled database, a suspended host — the next poll's claim can take the same row while the first
  claimant is still working. Both then run `processOne` concurrently.
- **Why it is Medium and not High**: the second application is a no-op **only because**
  `PaymentsService.applyGatewayOutcome` returns early when the payment is no longer `PENDING`
  (`payments.service.ts`). That guard is the entire mitigation, and it covers payments; the refund
  path (`RefundsService.applyGatewayOutcome`) and any future side effect of the same shape rely on
  their own guards, which are not asserted here.
- **Not fixed here**: the lease is a timeout, not a fencing token — a reclaimable row has no
  monotonic claim id for the writer to check. Fencing (or extending the lease while work is in
  flight) is the structural fix and is out of scope for this pass.
- **Acceptance criteria**: either the mitigation is stated at the guard that provides it and
  covered by a test per side-effect path, or fencing is implemented.
- **Risks**: Medium — silent duplicate application if a future consumer path is not idempotent.
  The lease duration is the tunable that trades this against recovery latency.

### DEF-13: Add `organizationId` to PaymentIntent and refund metadata (Low)
- **Objective**: Add `organizationId` to PaymentIntent and refund metadata at creation, and
  cross-check it in the processor.
- **Blocked on**: confirming whether payment retries reuse `payment.idempotency_key`, since Stripe
  rejects a key reused with different parameters.
- **Rationale**: defence in depth against our own cross-tenant bugs; signed payloads cannot be
  forged without our Stripe secret key.
- **Risks**: Low.

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