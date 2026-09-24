# Gym Management SaaS Database Plan

## Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    TENANCY_ORGANIZATIONS {
        uuid id PK
        string name
        string timezone
        string locale
        string currency
        timestamptz created_at
        timestamptz updated_at
        bool is_active
    }
    TENANCY_BRANCHES {
        uuid id PK
        uuid organization_id FK
        string name
        string address
        string phone
        timestamptz created_at
        timestamptz updated_at
        bool is_active
    }
IDENTITY_USERS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        string email
        string password_hash
        string first_name
        string last_name
        string phone
        timestamptz created_at
        timestamptz updated_at
        bool is_active
        bool email_verified
    }
    IDENTITY_ROLES {
        uuid id PK
        string name
        string description
    }
    IDENTITY_PERMISSIONS {
        uuid id PK
        string name
        string description
        string resource
        string action
    }
    IDENTITY_USER_ROLES {
        uuid id PK
        uuid user_id FK
        uuid role_id FK
    }
    IDENTITY_ROLE_PERMISSIONS {
        uuid id PK
        uuid role_id FK
        uuid permission_id FK
    }
    IDENTITY_AUTH_TOKENS {
        uuid id PK
        uuid user_id FK
        string token_type
        string token_value
        timestamptz expires_at
        timestamptz created_at
    }
    IDENTITY_MFA_SECRETS {
        uuid id PK
        uuid user_id FK
        string secret
        timestamptz created_at
    }
    MEMBERS_MEMBERS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid global_uuid UK
        int local_id UK (organization_id, local_id)
        string first_name
        string last_name
        string middle_name
        string preferred_name
        date date_of_birth
        string gender
        string phone
        string email
        string address_line1
        string address_line2
        string city
        string state
        string postal_code
        string country
        timestamptz created_at
        timestamptz updated_at
        bool is_active
        bool tax_exempt
        string tax_exempt_reason
    }
    MEMBERS_MEMBER_IDENTIFIERS {
        uuid id PK
        uuid member_id FK
        string identifier_type
        string identifier_value
        bool is_primary
    }
    MEMBERS_MEMBER_PROFILES {
        uuid id PK
        uuid member_id FK
        string height
        string weight
        string body_fat
        string medical_conditions
        string allergies
        string emergency_contact_name
        string emergency_contact_phone
        timestamptz updated_at
    }

MEMBERS_MEMBER_CONSENTS {
        uuid id PK
        uuid member_id FK
        string consent_type
        bool is_given
        timestamptz given_at
        timestamptz expires_at
        string document_url
    }
    MEMBERSHIP_PLANS {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        decimal price
        interval duration
        string billing_cycle
        int trial_days
        bool is_active
    }
    MEMBERSHIP_MEMBERSHIPS {
        uuid id PK
        uuid organization_id FK
        uuid member_id FK
        uuid plan_id FK
        uuid branch_id FK
        timestamptz start_date
        timestamptz end_date
        timestamptz next_payment_date
        string status
        int remaining_sessions
        bool is_on_hold
        timestamptz hold_start_date
        timestamptz hold_end_date
        decimal paused_fee
        timestamptz created_at
        timestamptz updated_at
    }
    MEMBERSHIP_MEMBERSHIP_PAUSES {
        uuid id PK
        uuid membership_id FK
        timestamptz start_date
        timestamptz end_date
        decimal fee
        timestamptz created_at
    }
    MEMBERSHIP_MEMBERSHIP_EXTENSIONS {
        uuid id PK
        uuid membership_id FK
        timestamptz extended_from
        timestamptz extended_to
        timestamptz created_at
    }
    MEMBERSHIP_MEMBERSHIP_CANCELLATIONS {
        uuid id PK
        uuid membership_id FK
        timestamptz cancelled_at
        string reason
        timestamptz created_at
    }
    MEMBERSHIP_MEMBERSHIP_TRANSFERS {
        uuid id PK
        uuid membership_id FK
        uuid new_branch_id FK
        timestamptz transferred_at
    }
    MEMBERSHIP_MEMBERSHIP_DISCOUNTS {
        uuid id PK
        uuid membership_id FK
        uuid organization_id FK
        string discount_type
        decimal amount
        timestamptz starts_at
        timestamptz ends_at
        timestamptz created_at
    }
    FINANCE_INVOICES {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        uuid membership_id FK
        string invoice_number UK (organization_id, invoice_number)
        timestamptz invoice_date
        timestamptz due_date
        decimal subtotal
        decimal tax_amount
        decimal total_amount
        string status
        timestamptz paid_at
        timestamptz created_at
        timestamptz updated_at
    }
    FINANCE_INVOICE_ITEMS {
        uuid id PK
        uuid invoice_id FK
        uuid organization_id FK
        string description
        decimal quantity
        decimal unit_price
        decimal line_total
        string tax_code
    }
    FINANCE_INVOICE_NUMBER_COUNTERS {
        uuid id PK
        uuid organization_id FK UK
        int last_invoice_number
    }
FINANCE_PAYMENTS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid invoice_id FK
        string payment_method
        string transaction_id
        decimal amount
        timestamptz payment_date
        string status
        string idempotency_key UK
        timestamptz created_at
    }
    FINANCE_PAYMENT_ALLOCATIONS {
        uuid id PK
        uuid payment_id FK
        uuid invoice_item_id FK
        decimal allocated_amount
        timestamptz created_at
    }
    FINANCE_REFUNDS {
        uuid id PK
        uuid payment_id FK
        string reason
        decimal amount
        timestamptz refund_date
        string status
        timestamptz created_at
    }
    FINANCE_CREDIT_NOTES {
        uuid id PK
        uuid invoice_id FK
        string reason
        decimal amount
        timestamptz issued_date
        string status
        timestamptz created_at
    }
    FINANCE_TAX_RATES {
        uuid id PK
        uuid organization_id FK
        string name
        string code UK (organization_id, code)
        decimal rate
        bool is_inclusive
        bool is_active
        timestamptz effective_from
        timestamptz effective_to
        timestamptz created_at
        timestamptz updated_at
    }
    FINANCE_TAX_LINES {
        uuid id PK
        uuid invoice_item_id FK
        uuid organization_id FK
        string tax_name
        decimal tax_rate
        decimal tax_amount
    }
    FINANCE_FINANCIAL_LEDGER {
        uuid id PK
        timestamptz transaction_date
        string account_type
        string account_number
        string description
        decimal debit_amount
        decimal credit_amount
        uuid reference_id FK
        string reference_type
        timestamptz created_at
    }
    CRM_LEADS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        string first_name
        string last_name
        string phone
        string email
        string source
        string status
        timestamptz created_at
        timestamptz updated_at
    }
    CRM_LEAD_SOURCES {
        uuid id PK
        string name
        string description
    }
    CRM_LEAD_STAGES {
        uuid id PK
        string name
        string description
        int sort_order
    }
    CRM_LEAD_ACTIVITIES {
        uuid id PK
        uuid lead_id FK
        string activity_type
        timestamptz occurred_at
        string notes
        uuid created_by FK
    }
CRM_FOLLOW_UPS {
        uuid id PK
        uuid lead_id FK
        string outcome
        timestamptz follow_up_date
        timestamptz completed_at
    }
    CRM_TRIALS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        timestamptz start_date
        timestamptz end_date
        string status
    }
    CRM_VISITS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        timestamptz visit_date
    }
    CRM_CONVERSIONS {
        uuid id PK
        uuid lead_id FK
        uuid membership_id FK
        timestamptz conversion_date
    }
    PT_TRAINERS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        string first_name
        string last_name
        string specialty
        string certification
        timestamptz hired_at
        timestamptz updated_at
        bool is_active
    }
    PT_TRAINER_AVAILABILITY {
        uuid id PK
        uuid trainer_id FK
        timestamptz start_time
        timestamptz end_time
        string recurrence
        bool is_active
    }
    PT_PACKAGES {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        int session_count
        decimal price
        timestamptz valid_from
        timestamptz valid_to
        bool is_active
    }
    PT_PT_ENROLLMENTS {
        uuid id PK
        uuid organization_id FK
        uuid member_id FK
        uuid package_id FK
        timestamptz start_date
        timestamptz end_date
        int sessions_used
        int sessions_remaining
        string status
        timestamptz created_at
        timestamptz updated_at
    }
    PT_PT_SESSIONS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        uuid trainer_id FK
        uuid enrollment_id FK
        timestamptz scheduled_start
        timestamptz scheduled_end
        timestamptz actual_start
        timestamptz actual_end
        string status
        string notes
    }
    PT_TRAINER_BOOKINGS {
        uuid id PK
        uuid trainer_id FK
        timestamptz start_time
        timestamptz end_time
        string booking_type
        string status
    }
PT_TRAINER_COMMISSIONS {
        uuid id PK
        uuid pt_session_id FK
        decimal amount
        timestamptz earned_at
        timestamptz paid_at
    }
    PT_WORKOUT_PLANS {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        bool is_active
    }
    PT_EXERCISES {
        uuid id PK
        string name
        string description
        string category
        string equipment_needed
    }
    PT_WORKOUT_ASSIGNMENTS {
        uuid id PK
        uuid workout_plan_id FK
        uuid exercise_id FK
        int sets
        int reps
        string weight
        int day_of_week
    }
    PT_WORKOUT_PROGRESS {
        uuid id PK
        uuid workout_assignment_id FK
        uuid member_id FK
        timestamptz date_completed
        int sets_completed
        int reps_completed
        string weight_used
        string notes
    }
    SCHEDULING_BATCHES {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid trainer_id FK
        string name
        string description
        int capacity
        bool is_active
    }
    SCHEDULING_BATCH_SCHEDULES {
        uuid id PK
        uuid batch_id FK
        timestamptz start_time
        timestamptz end_time
        string recurrence_pattern
        timestamptz start_date
        timestamptz end_date
        bool is_active
    }
    SCHEDULING_SERVICES {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        decimal price
        interval duration
        bool is_active
    }
    SCHEDULING_SERVICE_SCHEDULES {
        uuid id PK
        uuid service_id FK
        timestamptz start_time
        timestamptz end_time
        string recurrence_pattern
        timestamptz start_date
        timestamptz end_date
        bool is_active
    }
    SCHEDULING_MEMBER_BATCH_ENROLLMENTS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid batch_id FK
        uuid member_id FK
        timestamptz enrollment_date
        timestamptz start_date
        timestamptz end_date
        string status
    }
SCHEDULING_WAITLISTS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid batch_schedule_id FK
        uuid member_id FK
        timestamptz waitlist_position
        timestamptz added_at
    }
    SCHEDULING_CLASS_CAPACITY {
        uuid id PK
        uuid batch_schedule_id FK
        timestamptz start_time
        int current_count
        int capacity
    }
    ATTENDANCE_ATTENDANCE_EVENTS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid device_id FK
        uuid member_id FK
        timestamptz event_time
        string event_type
        string biometric_id
    }
    ATTENDANCE_ATTENDANCE_RECORDS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        timestamptz check_in_time
        timestamptz check_out_time
        string check_in_method
        string check_out_method
    }
    ATTENDANCE_ACCESS_DECISIONS {
        uuid id PK
        uuid attendance_event_id FK
        bool is_granted
        string reason
        timestamptz decided_at
    }
    ATTENDANCE_DEVICE_MAPPINGS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid device_id FK
        string external_device_id
        string biometric_id_mapping
    }
    ATTENDANCE_ELIGIBILITY_SNAPSHOTS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid member_id FK
        bool is_eligible
        timestamptz valid_from
        timestamptz valid_to
        timestamptz created_at
    }
    INVENTORY_INVENTORY_ITEMS {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        string sku
        string category
        decimal unit_cost
        decimal retail_price
        string unit_of_measure
        bool is_active
    }
    INVENTORY_INVENTORY_TRANSACTIONS {
        uuid id PK
        uuid inventory_item_id FK
        string transaction_type
        decimal quantity
        timestamptz transaction_date
        string reference_id
        string reference_type
    }
    INVENTORY_INVENTORY_LOTS {
        uuid id PK
        uuid inventory_item_id FK
        string lot_number
        timestamptz expiry_date
        decimal quantity
    }
INVENTORY_SUPPLIERS {
        uuid id PK
        string name
        string contact_person
        string phone
        string email
        string address
    }
    INVENTORY_PURCHASE_ORDERS {
        uuid id PK
        uuid organization_id FK
        uuid supplier_id FK
        timestamptz order_date
        timestamptz expected_delivery
        decimal total_amount
        string status
    }
    WORKOUTS_WORKOUT_TEMPLATES {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        bool is_active
    }
    WORKOUTS_WORKOUT_EXERCISES {
        uuid id PK
        uuid workout_template_id FK
        uuid exercise_id FK
        int sets
        int reps
        string weight
    }
    WORKOUTS_WORKOUT_SESSIONS {
        uuid id PK
        uuid workout_template_id FK
        uuid member_id FK
        timestamptz session_date
        string notes
    }
    WORKOUTS_EXERCISE_LIBRARIES {
        uuid id PK
        string name
        string description
        string category
    }
    DIET_DIET_PLANS {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        bool is_active
    }
    DIET_MEAL_TEMPLATES {
        uuid id PK
        uuid diet_plan_id FK
        string name
        string description
        int calories
        decimal protein
        decimal carbs
        decimal fat
    }
    DIET_NUTRITION_LOGS {
        uuid id PK
        uuid member_id FK
        uuid meal_template_id FK
        timestamptz log_date
        int servings
    }
    DIET_DIETARY_PREFERENCES {
        uuid id PK
        uuid member_id FK
        string preference_type
        string preference_value
    }
NOTIFICATIONS_NOTIFICATION_POLICIES {
        uuid id PK
        uuid organization_id FK
        string name
        string description
        string trigger_event
        string conditions
        timestamptz created_at
    }
    NOTIFICATIONS_NOTIFICATION_TEMPLATES {
        uuid id PK
        uuid organization_id FK
        string name
        string subject
        string body
        string channel
        string language
        timestamptz created_at
    }
    NOTIFICATIONS_NOTIFICATION_ATTEMPTS {
        uuid id PK
        uuid notification_template_id FK
        uuid recipient_id FK
        string recipient_type
        string content
        timestamptz sent_at
        string status
        string provider_response
    }
    NOTIFICATIONS_NOTIFICATION_DELIVERIES {
        uuid id PK
        uuid notification_attempt_id FK
        string provider_message_id
        timestamptz delivered_at
        string status
    }
    NOTIFICATIONS_NOTIFICATION_CHANNELS {
        uuid id PK
        string name
        string type
        string configuration
        bool is_active
    }
    REPORTS_REPORT_SCHEMAS {
        uuid id PK
        string name
        string description
        string query_definition
        timestamptz created_at
    }
    REPORTS_MATERIALIZED_VIEWS {
        uuid id PK
        string name
        string description
        timestamptz last_refreshed
    }
    SHARED_OUTBOX {
        uuid id PK
        string event_type
        string event_version
        uuid organization_id FK
        jsonb payload
        timestamptz occurred_at
        timestamptz created_at
        bool processed
    }
    SHARED_INBOX {
        uuid id PK
        string event_type
        string event_version
        uuid organization_id FK
        uuid event_id UK (event_type, event_version, organization_id, event_id)
        timestamptz processed_at
        bool success
    }
    SHARED_AUDIT_LOGS {
        uuid id PK
        uuid organization_id FK
        string entity_type
        uuid entity_id
        string action
        jsonb changes
        string performed_by
        timestamptz occurred_at
    }
```
## Invoice Numbering Scheme (`FINANCE_INVOICES.invoice_number`)

Invoice numbers are **per-organization, not global**. Each organization owns exactly one
counter row in `FINANCE_INVOICE_NUMBER_COUNTERS` (UNIQUE on `organization_id`) that holds its
`last_invoice_number`; allocation runs on the *same transaction* as the invoice insert, locking
that row with `pessimistic_write` (the same pattern as the member `local_id` counter in
`src/members/services/local-id.service.ts`), and formats the result as `INV-` plus the sequence
zero-padded to six digits — e.g. `INV-000001`.

- The sequence **restarts at 1 for every organization**: an organization's first invoice is
  `INV-000001`, regardless of how many invoices other organizations have issued.
- `UNIQUE (organization_id, invoice_number)` on `FINANCE_INVOICES` is the final backstop
  against a duplicate number inside one organization.
- Consequence for consumers (Phase 3 finance, reporting, exports): `invoice_number` is unique
  **per organization only** — always pair it with `organization_id`; never treat it as a
  globally unique key.
## Conventions

- Primary keys: UUID v4 for distributed identity, except for local sequential IDs (e.g., member.local_id) which use bigint with a per-organization sequence.
- Foreign keys: Explicitly defined with ON DELETE CASCADE where appropriate, otherwise ON DELETE RESTRICT.
- Monetary values: NUMERIC(15, 2) for currency amounts.
- Timestamps: timestamptz for all time values, stored in UTC.
- Enums: Use check constraints or lookup tables for status/state values.
- Constraints: NOT NULL where applicable, UNIQUE for alternate keys, CHECK for business rules.
- Indexes: Composite indexes for common query patterns, tenant-aware indexes (organization_id, ...), partial indexes for soft-deleted records.
- Tenancy: Every tenant-scoped table includes organization_id and/or branch_id as part of the primary key or as a foreign key with index.
## Row-Level Security (RLS) Policies

Enable RLS on all tenant-scoped tables and create policies that restrict rows to the current tenant context.

Example for members table:
```sql
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_tenant_isolation ON members
    USING (organization_id = current_setting('app.current_organization_id')::uuid);
```

Similar policies for branches, users, memberships, finance, etc.
## Concurrency Control Mapping

| Use Case | Technique | Implementation |
|----------|-----------|----------------|
| Membership renewal | Advisory lock | `pg_advisory_xact_lock(hashtext(organization_id || ':' || member_id))` within transaction |
| Payment processing | Unique constraint + idempotency_key | Unique constraint on (idempotency_key) and check for existing payment |
| Final batch seat | Insert with ON CONFLICT | Attempt to insert enrollment with unique constraint on (batch_schedule_id, member_id) and check capacity |
| PT trainer slot | Unique constraint on (trainer_id, start_time, end_time) where status='scheduled' | Prevent double-booking via unique constraint |
| Inventory decrement | Update with WHERE quantity >= | Update inventory set quantity = quantity - 1 where id = ? and quantity >= 1 returning quantity |
| Biometric event duplication | Unique constraint on (device_id, event_time, member_id) with normalization | Normalize event_time to minute precision and create unique constraint |
| Notification duplication | Idempotency key on notification attempts | Unique constraint on idempotency_key in notification_attempts |
| Concurrent member edits | Optimistic locking | version column incremented on each update, check version in WHERE clause |
| Invoice number allocation | Locked per-organization counter row | `SELECT ... FOR UPDATE` (`pessimistic_write`) on `FINANCE_INVOICE_NUMBER_COUNTERS` for the invoice's `organization_id`, incremented in the invoice transaction; `UNIQUE (organization_id, invoice_number)` on `FINANCE_INVOICES` as backstop |
## Indexing & Search Plan

### Tenant-Aware Indexes
```sql
CREATE INDEX idx_members_organization_id ON members(organization_id);
CREATE INDEX idx_memberships_organization_id ON memberships(organization_id);
CREATE INDEX idx_finance_invoices_organization_id ON invoices(organization_id);
-- Repeat for all tenant-scoped tables
```

### Composite Indexes for Common Queries
```sql
-- Members by name search
CREATE INDEX idx_members_first_last ON members(first_name, last_name);
-- Memberships active for member
CREATE INDEX idx_memberships_member_status ON memberships(member_id, status) WHERE status = 'active';
-- Attendance by member and date
CREATE INDEX idx_attendance_member_time ON attendance_records(member_id, check_in_time);
-- Invoice items by invoice
CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
-- Payments by member and date
CREATE INDEX idx_payments_member_time ON payments(member_id, payment_date);
```

### Full-Text Search (PostgreSQL built-in)
```sql
-- For member name search
CREATE INDEX idx_members_fts ON members USING GIN (to_tsvector('english', first_name || ' ' || last_name));
-- For email search
CREATE INDEX idx_members_email ON members(email);
-- For phone search
CREATE INDEX idx_members_phone ON members(regexp_replace(phone, '[^0-9]', '', 'g'));
```

### Trigram Search for Fuzzy Matching
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_members_name_trgm ON members USING GIN (first_name gin_trgm_ops, last_name gin_trgm_ops);
```

### Partial Indexes for Soft-Deletes
```sql
CREATE INDEX idx_members_active ON members(is_active) WHERE is_active = true;
CREATE INDEX idx_memberships_active ON memberships(status) WHERE status = 'active';
```
## Partitioning & Archival Triggers

### Attendance Table Partitioning (by month)
```sql
CREATE TABLE attendance_events_partitioned (
    LIKE attendance_events INCLUDING ALL
) PARTITION BY RANGE (event_time);

-- Create monthly partitions
CREATE TABLE attendance_events_y2026m01 PARTITION OF attendance_events_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- Repeat for each month, automate with a procedure

-- Attach existing data
ALTER TABLE attendance_events PARTITION BY RANGE (event_time);
-- Then migrate data to partitions (not shown for brevity)
```

### Financial Ledger Archival
- Archive ledger entries older than 7 years to an archive table or data warehouse.
- Archive trigger: monthly job that moves data from `financial_ledger` to `financial_ledger_archive` where transaction_date < current_date - interval '7 years'.
## Read-Replica & Materialized View Reporting Schema

### Read Replica Configuration
- Deploy PostgreSQL read replicas in the same region for vertical scaling of read queries.
- Use asynchronous replication for scaling reads.
- Direct read-heavy workloads (reports, dashboards, list views) to read replicas via connection routing.

### Materialized Views for Reporting
```sql
-- Member summary for dashboard
CREATE MATERIALIZED VIEW mv_member_summary AS
SELECT 
    m.id AS member_id,
    m.first_name || ' ' || m.last_name AS full_name,
    ms.status AS membership_status,
    ms.next_payment_date,
    COUNT(ae.id) AS visit_count_last_30_days,
    MAX(ae.event_time) AS last_visit
FROM members m
LEFT JOIN memberships ms ON m.id = ms.member_id AND ms.status = 'active'
LEFT JOIN attendance_events ae ON m.id = ae.member_id AND ae.event_time >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY m.id, m.first_name, m.last_name, ms.status, ms.next_payment_date
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_member_summary_member_id ON mv_member_summary(member_id);
-- Refresh periodically (e.g., every hour) via CONCURRENTLY

-- Revenue by organization per month
CREATE MATERIALIZED VIEW mv_monthly_revenue AS
SELECT 
    i.organization_id,
    date_trunc('month', i.invoice_date) AS month,
    SUM(i.total_amount) AS gross_revenue,
    COUNT(i.id) AS invoice_count
FROM invoices i
WHERE i.status = 'paid'
GROUP BY i.organization_id, date_trunc('month', i.invoice_date)
WITH NO DATA;

CREATE INDEX idx_mv_monthly_revenue_org_month ON mv_monthly_revenue(organization_id, month);
-- Refresh daily
```

### Reporting Schema Isolation
- Create a `reporting` schema that owns all materialized views and reporting-specific tables.
- Grant read access to reporting workers and analytics tools.
- Ensure reporting schema is updated via refresh jobs that run during off-peak hours.
## Backup & Recovery Strategy

### Backup
- Base backups: Weekly full + daily incremental using pgBackRest or similar.
- WAL archiving: Continuous archiving to S3 for PITR.
- Backup verification: Monthly restore test to staging environment.

### Recovery
- Point-in-time recovery (PITR) capability to any point within the retention period.
- Recovery time objective (RTO): < 1 hour for critical services.
- Recovery point objective (RPO): < 5 minutes via WAL streaming.
## Storage Estimates & Growth

| Table | Initial Size | Monthly Growth | Notes |
|-------|--------------|----------------|-------|
| attendance_events | 10 GB | 500 GB | High-volume, partitioned |
| financial_ledger | 5 GB | 50 GB | Append-only, archived after 7 years |
| members | 2 GB | 5 GB | Steady growth |
| memberships | 3 GB | 20 GB | Moderate growth |
| invoices | 4 GB | 300 GB | High volume, includes line items |
| audit_logs | 1 GB | 100 GB | High volume, retention 2 years |
| Others | < 1 GB each | < 10 GB each | Varies |

Total estimated storage after 1 year: ~5 TB (before archiving), ~2 TB after archiving old ledger and attendance.
## Performance Tuning Recommendations

- `shared_buffers`: 25% of RAM
- `effective_cache_size`: 70% of RAM
- `work_mem`: 64MB (adjust based on concurrent complex queries)
- `maintenance_work_mem`: 256MB
- `wal_buffers`: 16MB
- `checkpoint_timeout`: 15min
- `max_wal_size`: 2GB
- `min_wal_size`: 80MB
- `default_statistics_target`: 100
- `random_page_cost`: 1.1 (for SSD)
- `effective_io_concurrency`: 200 (for SSD)
## Connection Pooling
- Use PgBouncer in transaction pooling mode.
- Pool size: 20-50 connections per application instance depending on workload.
## Extensions
- Required extensions: `uuid-ossp`, `pg_trgm`, `btree_gin`, `pgcrypto`
- Optional: `timescaledb` for time-series analytics (if needed in future)
## Database Migration Strategy

- Use schema versioning tool (e.g., Flyway, Liquibase) or custom migration scripts.
- All migrations must be backward-compatible for zero-downtime deployment.
- Strategy: 
  1. Additive changes only (add columns, tables, indexes)
  2. Deploy code that handles both old and new schema
  3. Backfill data asynchronously
  4. Migrate reads to new schema
  5. Remove old schema components
## Testing
- Automated tests for schema validity, index coverage, RLS policies.
- Performance test with production-equivalent data volumes.
- Chaos testing for database failover and network partitions.
---
*Document Version: 1.0*
*Last Updated: 2026-09-01*