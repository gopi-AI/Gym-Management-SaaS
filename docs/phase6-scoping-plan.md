# Phase 6 — Structured Reporting &amp; Analytics Layer

**Date:** 2026-09-17  
**Status:** DRAFT — scoping and design  
**Target:** NestJS backend + Next.js frontend  
**Prerequisite reading:** `docs/database-plan.md`, `docs/api-plan.md`, `docs/implementation-roadmap.md`, `docs/task-backlog.md`, `src/shared/workers/` (existing background job infrastructure)

---

## 1. Domain Analysis — What Exists vs. What Is Needed

### 1.1 Existing AI Analytics (src/ai/ — Phase 2B)

The existing AI module provides **three intelligence services** that are deliberately *outside* the scope of Phase 6:

| Service | Purpose | Phase 6 Relationship |
|---|---|---|
| `RetentionService` | LLM-driven at-risk member identification + churn prediction | **Out of scope** — AI is separate. Phase 6 dashboards MAY surface retention-service results as a data source, but the AI logic itself is not duplicated. |
| `PlanPerformanceService` | LLM-driven plan/pricing scoring | **Out of scope** — same boundary. |
| `AiUsageService` | Metering: token/request tracking + budget enforcement | Phase 6 MAY report on AI consumption (aggregate cost trends, budget utilization) as a reporting data source, but metering itself remains in AI. |

### 1.2 Existing Structured Data Sources

Every module below has **TypeORM entities + migrations** already deployed. The columns and relationships listed are *known reportable fields* — not an exhaustive schema dump.

| Module | Key Entities | Tenancy | Reportable Dimensions | Measures |
|---|---|---|---|---|
| **Members** (`members`) | `Member` | `organization_id` | created_at (join date), date_of_birth, gender, branch_id, is_active (soft-delete flag only) | count, new members |
| **Memberships** (`memberships/`) | `Membership`, `MembershipPlan`, `MembershipHistory` | `organization_id`, `branch_id` | plan_name, status (active/paused/frozen/cancelled/expired), billing_cycle, start/end dates | active count, churn rate, avg duration, cancellation trend |
| **Finance** (`finance/`) | `Invoice`, `InvoiceItem`, `Payment`, `Refund`, `PaymentAllocation` | `organization_id`, `branch_id` | status, date_range, payment_method, invoice_number | total revenue, outstanding, avg invoice value, payment method mix |
| **Attendance** (`attendance/`) | `AttendanceRecord`, `AttendanceEvent` | `organization_id`, `branch_id` | check_in/out times, member_id, event_type | check-ins/day, peak hours, avg session duration, week-over-week trend |
| **Workouts** (`workouts/`) | `WorkoutSession`, `WorkoutSessionExercise`, `WorkoutPlanAssignment` | `organization_id`, `member_id` | session_date, duration_minutes, exercises logged, plan_template | total sessions, avg duration, exercise adherence, trend |
| **Diet** (`diet/`) | `NutritionLog`, `DietPlanAssignment` | `organization_id`, `member_id` | log_date, meal_template, macro values (calories, protein_g, carbs_g, fat_g) | daily avg macros, meals logged, missing-macro ratio, plan adherence |
| **PT** (`pt/`) | `PtEnrollment`, `PtSession`, `TrainerCommission` | `organization_id`, `branch_id` | trainer_id, session_date, status, package_price, currency | session count, commission earned, trainer utilization, revenue |
| **Loyalty** (`loyalty/`) | `LoyaltyAccount`, `LoyaltyTransaction` | `organization_id`, `member_id` | transaction_type, points_change, reason | total points, points burned, redemption rate, active accounts |
| **AI Usage** (`ai/`) | `AiUsageRecord` | `organization_id` | model, operation, cost, token count | total cost, avg cost/request, budget remaining, token trends |

### 1.3 Reporting Gaps

| What's Missing | Current State | Phase 6 Solution |
|---|---|---|
| **Structured report catalog** | No report schema/definition store | New `REPORTS_REPORT_SCHEMAS` table (exists in DB plan DDL) |
| **Async report execution** | All data reads are synchronous API queries | New `REPORTS_REPORT_JOBS` table + worker for long-running report generation |
| **Materialized views** | Real-time queries only, no pre-aggregated snapshots | New `REPORTS_MATERIALIZED_VIEWS` table + refresh worker |
| **Export (CSV/Excel)** | No export capability | S3-based export + download link pattern (reuse existing `S3Service`) |
| **Non-AI dashboards** (dashboard page currently shows only AI analytics) | Dashboard shows AI usage/retention. No structured reporting dashboards exist. | New report execution + chart components with recharts |
| **Report scheduling** | No periodic report generation | Worker cron pattern for scheduled report jobs |
| **Scheduled email delivery** | No email infrastructure in the project | Out of Phase 6 scope — recommend SendGrid/Mailgun integration in Phase 7 |

---

## 2. Architecture Overview

### 2.1 New NestJS Module: `src/reports/`

```
src/reports/
├── reports.module.ts              # Module definition
├── controllers/
│   ├── report-schemas.controller.ts    # CRUD for report definitions
│   ├── report-jobs.controller.ts       # Execute, status, list
│   └── materialized-views.controller.ts # List, refresh, query
├── services/
│   ├── report-schemas.service.ts       # Schema CRUD logic
│   ├── report-jobs.service.ts          # Job lifecycle management
│   ├── report-executor.service.ts      # Orchestrates SQL/query execution
│   ├── export.service.ts               # CSV/Excel generation + S3 upload
│   └── materialized-views.service.ts   # Refresh triggers + scheduling
├── entities/
│   ├── report-schema.entity.ts         # Maps to REPORTS_REPORT_SCHEMAS
│   └── report-job.entity.ts            # Maps to REPORTS_REPORT_JOBS
├── workers/
│   └── report-execution.worker.ts      # BackgroundWorker for async execution
├── dashboards/                          # Domain-specific dashboard definitions
│   ├── members.dashboard.ts
│   ├── finance.dashboard.ts
│   ├── attendance.dashboard.ts
│   ├── workouts.dashboard.ts
│   ├── diet.dashboard.ts
│   ├── pt.dashboard.ts
│   ├── loyalty.dashboard.ts
│   └── ai-usage.dashboard.ts
└── schemas/                             # Predefined report definitions
    ├── member-reports.schema.ts
    ├── finance-reports.schema.ts
    ├── attendance-reports.schema.ts
    ├── workouts-reports.schema.ts
    ├── diet-reports.schema.ts
    ├── pt-reports.schema.ts
    ├── loyalty-reports.schema.ts
    └── ai-usage-reports.schema.ts
```

### 2.2 Module Dependencies

```
ReportsModule
  ├── imports: TypeOrmModule, WorkersModule, S3Module, SharedModule
  ├── depends-on (data sources — not NestJS imports, just entity queries):
  │   ├── MembersModule entities      (read-only queries)
  │   ├── MembershipsModule entities   (read-only queries)
  │   ├── FinanceModule entities       (read-only queries)
  │   ├── AttendanceModule entities    (read-only queries)
  │   ├── WorkoutsModule entities      (read-only queries)
  │   ├── DietModule entities          (read-only queries)
  │   ├── PtModule entities            (read-only queries)
  │   ├── LoyaltyModule entities       (read-only queries)
  │   └── AiModule entities            (read-only queries)
  └── exports: ReportService (for use by other modules like AI)
```

> **Design rationale**: Reports module is a **read-only consumer** of all domain entities. It does NOT import domain *services* — it queries TypeORM repositories directly for reporting purposes. This prevents circular dependencies and keeps reporting logic decoupled from business logic.

### 2.3 Frontend Module: `apps/web/src/app/reports/`

```
apps/web/src/app/reports/
├── page.tsx                           # Report catalog listing
├── [id]/
│   └── page.tsx                       # Report detail + execution
├── jobs/
│   └── [id]/
│       └── page.tsx                   # Job status + result viewer
├── dashboards/
│   ├── page.tsx                       # Dashboard hub
│   ├── members/
│   │   └── page.tsx                   # Membership/retention dashboard
│   ├── finance/
│   │   └── page.tsx                   # Revenue dashboard
│   ├── attendance/
│   │   └── page.tsx                   # Check-in trends dashboard
│   ├── workouts/
│   │   └── page.tsx                   # Workout volume dashboard
│   ├── diet/
│   │   └── page.tsx                   # Nutrition dashboard
│   ├── pt/
│   │   └── page.tsx                   # PT/trainer dashboard
│   ├── loyalty/
│   │   └── page.tsx                   # Loyalty dashboard
│   └── ai-usage/
│       └── page.tsx                   # AI cost dashboard
├── components/
│   ├── ReportSchemaForm.tsx           # Create/edit report schema
│   ├── ReportJobStatus.tsx            # Job progress + result display
│   ├── ReportResultTable.tsx          # Tabular result renderer
│   ├── ChartContainer.tsx             # Chart wrapper (recharts)
│   ├── ExportButton.tsx               # CSV/Excel download trigger
│   └── DashboardWidget.tsx            # Shared widget card
└── lib/
    └── reports-api.ts                 # API client for reports endpoints
```

### 2.4 New Dependencies

| Package | Version | Purpose |
|---|---|---|
| `recharts` | ^2.x | Dashboard charting (bar, line, pie, area) |
| `exceljs` | ^4.x | XLSX workbook generation for exports |
| `@tanstack/react-table` | ^9.x | Headless sort/filter/pagination for report result grids (P6-18). Latest is 9.2.4 (peer `react >=18`, matches this project's React 18.3.1); if the team prefers the older v8 line, that is a one-line change. |
| (No new backend heavy dependencies) | | Reuse existing `S3Service` for **uploads**; reuse existing `WorkersModule` for jobs. **Caveat:** `S3Service` has no read/stream method, so the download endpoint needs new S3 read support — see §8.3. That work is **not budgeted** here. |

> **Decision**: Use **recharts** (not Chart.js, nivo, or D3 directly). recharts is React-native, composable, and the simplest charting choice for the dashboard use case. No backend email or PDF library is added — email delivery is deferred to Phase 7, and PDF generation can be added later via Playwright/PDF or the same export-to-Excel process.

---

## 3. New Database Tables

### 3.1 `REPORTS_REPORT_SCHEMAS` (already exists in DB plan DDL — needs finalization)

```sql
CREATE TABLE "REPORTS_REPORT_SCHEMAS" (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES "TENANCY_ORGANIZATIONS"(id) ON DELETE CASCADE,
    name              VARCHAR(200) NOT NULL,
    description       TEXT,
    category          VARCHAR(50) NOT NULL DEFAULT 'custom',
                      -- 'member'|'finance'|'attendance'|'workout'|'diet'|'pt'|'loyalty'|'ai-usage'|'custom'
    query_definition  JSONB NOT NULL DEFAULT '{}',
    parameters        JSONB NOT NULL DEFAULT '[]',
    is_system         BOOLEAN NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by        UUID REFERENCES "IDENTITY_USERS"(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_report_schemas_org     ON "REPORTS_REPORT_SCHEMAS"(organization_id);
CREATE INDEX idx_report_schemas_category ON "REPORTS_REPORT_SCHEMAS"(category);
```

#### 3.1.1 `query_definition` Structure

The query definition is a **structured JSON** — NOT raw SQL — that `ReportExecutorService` compiles into a safe query. This prevents SQL injection from user-defined schemas.

```typescript
interface QueryDefinition {
  /** The primary data source entity */
  source: string;
  /** Column selections: {alias: "source_column" or aggregate} */
  columns: Record<string, string>;
  /** WHERE clause conditions (compiled safely) */
  filters?: FilterClause[];
  /** GROUP BY columns */
  group_by?: string[];
  /** ORDER BY clause */
  order_by?: { column: string; direction: 'ASC' | 'DESC' }[];
  /** LIMIT */
  limit?: number;
}

interface FilterClause {
  /** Column the condition applies to (validated against the source allowlist) */
  column: string;
  /** Comparison operator — compiled to a parameterized fragment, never interpolated */
  operator:
    | '='
    | '!='
    | '>'
    | '>='
    | '<'
    | '<='
    | 'BETWEEN'
    | 'IN'
    | 'NOT IN'
    | 'LIKE'
    | 'IS NULL'
    | 'IS NOT NULL';
  /**
   * Literal, list (for BETWEEN / IN), or a `$name` placeholder resolved from the
   * report parameters at execution time (e.g. `"$orgId"`, `"$from"`, `"$to"`).
   */
  value?: unknown | unknown[];
}
```

> **Rationale vs. raw SQL**: A structured definition allows the executor to validate columns against a known allowlist (preventing access to columns not in the entity's reporting schema), apply tenant-scoping (`organization_id = :orgId`) automatically, and generate parameterized queries.

> **Known contradiction with §16 (surfaced, not resolved)**: The §16 examples place raw SQL *expressions* in `columns` — e.g. `"COUNT(*)"`, `"SUM(total_amount)"`, and a date-truncation expression. Arbitrary expressions cannot be checked against a column allowlist, so the safety guarantee stated above holds only for plain column references and a fixed set of allowlisted aggregates. Either the executor must restrict `columns` to that subset (in which case the §16 examples must be rewritten to match), or this allowlist guarantee must be explicitly weakened. This is an open decision — it is deliberately left visible here rather than silently dropped.

### 3.2 `REPORTS_REPORT_JOBS` (new table)

```sql
CREATE TABLE "REPORTS_REPORT_JOBS" (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES "TENANCY_ORGANIZATIONS"(id) ON DELETE CASCADE,
    report_schema_id  UUID REFERENCES "REPORTS_REPORT_SCHEMAS"(id),
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
                      -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    parameters        JSONB,
    result_s3_key     VARCHAR(500),
    result_s3_bucket  VARCHAR(200),
    result_rows       INTEGER,
    result_format     VARCHAR(10) DEFAULT 'json',
    error_message     TEXT,
    progress_pct      INTEGER DEFAULT 0,
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_by        UUID REFERENCES "IDENTITY_USERS"(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_report_jobs_org         ON "REPORTS_REPORT_JOBS"(organization_id);
CREATE INDEX idx_report_jobs_status      ON "REPORTS_REPORT_JOBS"(status);
CREATE INDEX idx_report_jobs_schema_id   ON "REPORTS_REPORT_JOBS"(report_schema_id);
CREATE INDEX idx_report_jobs_created_at  ON "REPORTS_REPORT_JOBS"(created_at DESC);
```

> **Queue-depth guard (pending jobs) — not an execution limit**: A single organization SHOULD NOT have more than `MAX_PENDING_JOBS` (configurable, default 2) **outstanding `pending` jobs** at any moment. Exceeding it returns `429 Too Many Requests` from the API path (before the job row is created). Use a Redis counter keyed by `organization_id`, decremented when a job reaches a terminal state (`completed` / `failed` / `cancelled`).
>
> This is deliberately a *queue-depth* guard, not a *concurrency* limit: execution concurrency is unchanged and remains serialized to one job globally — see §5.1/§5.2, which this note does not alter. The guard exists to stop one tenant from filling the backlog that a single worker must drain.

### 3.3 `REPORTS_USER_REPORT_FAVORITES` (optional — Phase 6.2)

```sql
CREATE TABLE "REPORTS_USER_REPORT_FAVORITES" (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES "IDENTITY_USERS"(id) ON DELETE CASCADE,
    report_schema_id  UUID NOT NULL REFERENCES "REPORTS_REPORT_SCHEMAS"(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, report_schema_id)
);
```

### 3.4 `REPORTS_MATERIALIZED_VIEWS` (in the DB plan as an ERD node only — the migration still has to be written)

This table appears in `docs/database-plan.md` **only as a Mermaid ERD node** — that file contains no SQL DDL for it. A repository-wide search finds no migration that creates it, so **the table does not exist in the database today** and its physical name is undefined until a migration is written. Phase 6 **adopts** it as the registry of materialized-view definitions that §4.3's endpoints and §7.4's refresh flow operate against, and therefore has to **create it** (§7.4's registration `INSERT`s have nowhere to write until it exists). It is reproduced here so §3 is self-contained.

```sql
CREATE TABLE "REPORTS_MATERIALIZED_VIEWS" (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    last_refreshed  TIMESTAMPTZ
);
```

> **Note**: the DB-plan shape carries no `organization_id` — this is a **platform-level registry** of view definitions, not tenant-scoped data. Tenant isolation is enforced by each materialized view's own `organization_id` grouping, not by this table.

> **Open gap — this table has no migration**: the shape above is a hand-translation of the `REPORTS_MATERIALIZED_VIEWS` node in `docs/database-plan.md`'s **Mermaid ERD** (that file contains no SQL for it — the node sits inside a ```` ```mermaid ```` fence). `grep -rln "REPORTS_MATERIALIZED_VIEWS" src/` returns nothing, so **no migration creates this table** and its physical name is undefined until one is written. §7.4's registration step depends on that migration existing. The quoted `"REPORTS_MATERIALIZED_VIEWS"` form above is the name that migration must use, matching every other table in the project (51/51 `CREATE TABLE` statements in `src/migrations/` quote an `UPPER_SNAKE` name, as does every `@Entity()` in `src/`).

---

## 4. API Contract

### 4.1 Report Schemas

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/report/schemas` | List active report schemas (org-scoped) |
| `POST` | `/v1/report/schemas` | Create a new custom report schema |
| `GET` | `/v1/report/schemas/{id}` | Get schema details + parameter definitions |
| `PUT` | `/v1/report/schemas/{id}` | Update a custom schema |
| `DELETE` | `/v1/report/schemas/{id}` | Delete a custom schema (reject system schemas) |
| `POST` | `/v1/report/schemas/{id}/execute` | Execute a report (async — creates a job) |

### 4.2 Report Jobs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/report/jobs` | List recent report jobs (org-scoped, paginated) |
| `GET` | `/v1/report/jobs/{id}` | Get job status, progress, and result metadata |
| `POST` | `/v1/report/jobs/{id}/cancel` | Cancel a pending/running job |
| `GET` | `/v1/report/jobs/{id}/download` | Download export file (stream from S3 — requires a **new** S3 read method, see §8.3) |

### 4.3 Materialized Views (Phase 6.2)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/report/materialized-views` | List materialized views (from `REPORTS_MATERIALIZED_VIEWS` — §3.4) |
| `POST` | `/v1/report/materialized-views/{id}/refresh` | Trigger refresh |
| `GET` | `/v1/report/materialized-views/{id}/data` | Query materialized view |

> `{id}` is `REPORTS_MATERIALIZED_VIEWS.id` (§3.4) — the registry table carried in the DB plan as an ERD node, which Phase 6 must create before these endpoints can resolve anything. The view's SQL identifier is resolved from that row's `name`.

### 4.4 Dashboards

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/report/dashboards/overview` | Aggregated KPIs for the hub page |
| `GET` | `/v1/report/dashboards/{domain}` | Domain-specific dashboard data |

---

## 5. Async Job Execution Flow

```
Client                          ReportsModule                      WorkersModule
  │                                  │                                  │
  │  POST /schemas/{id}/execute      │                                  │
  │ ─────────────────────────────►   │                                  │
  │                                  │  1. Validate schema + params     │
  │                                  │  2. Create report_job (pending)  │
  │                                  │ ──────────────────────────────►  │
  │  202 { jobId, status: "pending" }│                                  │
  │ ◄─────────────────────────────   │                                  │
  │                                  │                                  │
  │                                  │                                  │  3. BackgroundWorker picks up job
  │                                  │                                  │  4. UPDATE status = 'running'
  │                                  │                                  │     progress_pct = 10
  │                                  │                                  │
  │                                  │                                  │  5. ReportExecutorService:
  │                                  │                                  │     - Resolve query_definition
  │                                  │                                  │     - Append tenant filter
  │                                  │                                  │     - Execute query
  │                                  │                                  │     - Update progress_pct
  │                                  │                                  │
  │                                  │                                  │  6. If export requested:
  │                                  │                                  │     - ExportService generates
  │                                  │                                  │       CSV/XLSX → Buffer
  │                                  │                                  │     - S3Service.upload(key, buf)
  │                                  │                                  │     - Store result_s3_key
  │                                  │                                  │
  │                                  │                                  │  7. UPDATE status = 'completed'
  │                                  │                                  │     result_rows = N
  │                                  │                                  │
  │  GET /jobs/{jobId}               │                                  │
  │ ─────────────────────────────►   │  Return current status           │
  │ ◄─────────────────────────────   │                                  │
  │                                  │                                  │
  │  GET /jobs/{jobId}/download      │                                  │
  │ ─────────────────────────────►   │  Stream from S3                  │
  │ ◄─────────────────────────────   │                                  │
```

### 5.1 Worker Configuration

The report execution worker extends `BackgroundWorker` and uses the same environment-variable-based config pattern as existing workers:

| Variable | Default | Purpose |
|---|---|---|
| `WORKERS_ENABLED` | `false` | Master switch for all workers |
| `WORKERS_REPORT_EXECUTION_ENABLED` | inherits WORKERS_ENABLED | Per-worker override |
| `WORKERS_REPORT_EXECUTION_INTERVAL_MS` | `5000` | Polling interval for pending jobs |
| `REPORT_JOB_TIMEOUT_MS` | `300000` (5 min) | Per-job timeout before auto-fail |

Interactive dashboard queries remain synchronous HTTP — they are not enqueued.
Scheduled/materialized view refresh also uses `BackgroundWorker`, with its own interval or a `@Cron` decorator via `@nestjs/schedule`.

> **First-version scope decision**: Global job concurrency is deliberately set to `1` (no overlap). The `BackgroundWorker` base class enforces this via its built-in `isRunning` guard, matching the pattern used by existing workers (outbox, membership-expiry, payment-retry). This avoids queue-backlog complexity in v1. If throughput becomes a bottleneck, future versions can run multiple worker containers with job-level fencing via the `status` field and a `taken_by` timestamp column.

### 5.2 Job Timeout & Concurrency

| Setting | Default | Env Variable |
|---|---|---|
| Per-job timeout | 5 minutes | `REPORT_JOB_TIMEOUT_MS` |
| Global concurrency | 1 (no overlap) | Built-in `isRunning` guard in `BackgroundWorker` |
| Multi-instance fencing | N/A (v1) | Future: `status` + `taken_by` timestamp

---

## 6. Predefined Report Catalog (System Schemas)

These are the platform-defined reports created as seed data. They are marked `is_system = true` and cannot be deleted by users.

### 6.1 Member Reports

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **New Members (Daily/Weekly/Monthly)** | New member sign-ups over time | `Member` | created_at (join date), count, cumulative | date_range |
| **Member Demographics** | Age/gender/location breakdown | `Member` | date_of_birth (age_group derived), gender, branch_id (location), count | date_range |
| **Active vs. Churned** | Live vs. cancelled/expired memberships over time | `Membership` + `MembershipHistory` | status, month, count | date_range |
| **Membership Tenure Distribution** | How long members stay | `Membership` | tenure_months, count | status |

> **Definition — "active in a month" is the `>` boundary, plus a termination cutoff (explicit decision)**: a membership counts as active for a given month if it was active **at any point during that month**. Two conditions produce that set, and both are needed:
>
> 1. **Overlap with the contractual term.** The month window is `[month, month + 1 month)`; the membership's `[start_date, end_date]` must overlap it — the month's **last** day `>= start_date`, and (`end_date IS NULL` OR the month's **first** day `<= end_date`). A membership whose `end_date` is exactly the 1st of a month therefore **does** count for that month (it was active for one day of it).
> 2. **Termination cutoff.** `end_date` is **not** rewritten when a membership is cancelled or expires — `MembershipsService.cancel()` writes only `status`, `cancelled_at` and `cancellation_reason` (`src/memberships/services/memberships.service.ts`), leaving the original contractual `end_date` intact. Relying on condition 1 alone would therefore count a cancelled membership as active until its original term end (e.g. a membership cancelled in month 2 of a 12-month term would count as active for all 12 months), and **unboundedly** when `end_date IS NULL`. The cutoff takes the earliest terminal transition from `MEMBERSHIPS_MEMBERSHIP_HISTORY` (`to_status IN ('cancelled','expired')`) and requires the month's **first** day `<=` that date, so the termination month still counts as active. A membership with no terminal transition gets no cutoff.
>
> **Cancellation before `end_date` is therefore handled as: the membership stays active through the end of the calendar month in which the cancellation occurred, and is counted as churned in that same month.** It does not stay active until the contractual `end_date`. Where cancellation falls **exactly on the 1st** of a month, that month counts as active (the boundary is inclusive at both ends) and is also the churn month. A membership that both starts and terminates inside one calendar month counts as active for that month (it was active on the days before the transition) and is counted as churned in it — verified by execution: a membership starting 2026-03-05 and cancelled 2026-03-20 yields `active_members = 1, churned_members = 1, churn_rate_pct = 100.00` for March 2026.
>
> Churn is attributed **per membership**, not per organization: the churn set joins on `membership_id` *and* month against the same `member_months` set that produces `active_members`. This matters — joining only on `(organization_id, month)` lets a terminal transition be counted in a month that the membership was never in (e.g. a termination whose `occurred_at` precedes the membership's own `start_date`), which produced `churned_members = 2` against `active_members = 1` — a **200% churn rate** — in an executed reproduction. Scoping the join to `membership_id` makes `churned_members` a subset of `active_members` by construction, so `churn_rate_pct` cannot exceed 100%.
>
> This one predicate is applied identically in `reports_mv_member_churn_monthly` and `reports_mv_membership_active_monthly` (§7.2), so the two can never disagree about which month a membership belongs to. Changing the boundary — to "active at month start", "active for the whole month", or dropping the termination cutoff — is a **scope/definition change, not a bug fix**: it silently rewrites every historical month's figures, exactly as the "overdue, no grace period" boundary does (§6.2).

### 6.2 Finance Reports

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **Revenue Summary** | Total revenue by period | `Invoice` | invoice_date, total_amount, status | date_range, branch |
| **Revenue by Plan** | Revenue grouped by membership plan | `Invoice` + `InvoiceItem` | plan_name, total | date_range |
| **Outstanding Invoices** | Unpaid invoices aging | `Invoice` | invoice_date, due_date, days_overdue (derived, no grace period — `GREATEST(0, EXTRACT(EPOCH FROM (now() - due_date)) / 86400)::int`), amount | branch |
| **Payment Method Mix** | Payment method distribution | `Payment` | payment_method, count, total | date_range |
| **Refund Report** | Refunds over time | `Refund` | refund_date, amount, reason | date_range |

> **Definition — "overdue" has no grace period (explicit decision)**: an invoice counts as overdue the moment `due_date` passes while its status is **non-terminal** (`draft`, `sent`, `partially_paid`). There is no grace window. `overdue` is a **derived condition, never a stored status** — the `FINANCE_INVOICES.status` machine is `draft → sent → partially_paid → paid`, plus `void`, so a `= 'overdue'` predicate would silently match nothing. Adding a grace period later is a **scope change, not a bug fix**.

### 6.3 Attendance Reports

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **Daily Check-ins** | Check-in count by day | `AttendanceRecord` | check_in_time, count, unique_members | date_range, branch |
| **Peak Hours** | Check-in volume by hour | `AttendanceRecord` | hour, avg_count, peak_count | date_range, branch |
| **Avg Session Duration** | Average workout duration | `AttendanceRecord` | member_id, avg_duration | date_range |
| **Week-over-Week Trend** | Attendance trend comparison | `AttendanceRecord` | week, count, ww_change | branch |

### 6.4 Workout Reports

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **Workout Volume** | Total sessions logged over time | `WorkoutSession` | session_date, count | date_range, member |
| **Avg Workout Duration** | Average duration trend | `WorkoutSession` | week, avg_duration_minutes | date_range |
| **Plan Assignment Adherence** | Active vs expired plan assignments | `WorkoutPlanAssignment` | template_id, status, count | date_range |
| **Most Used Exercise Templates** | Template popularity ranking | `WorkoutSessionExercise` | template_name, session_count | date_range |

### 6.5 Diet Reports

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **Daily Macro Summary** | Avg daily calories, protein, carbs, fat | `NutritionLog` | log_date, avg_calories, avg_protein_g | date_range, member |
| **Logging Frequency** | How often members log meals | `NutritionLog` | week, member_id, log_count, avg_gap | date_range |
| **Meals Missing Macros** | Percentage of entries without macro data | `NutritionLog` | period, total_logs, missing_macros, pct | date_range |
| **Active Diet Plan Count** | Active plan assignments over time | `DietPlanAssignment` | status, diet_plan_id, count | date_range |

### 6.6 PT Reports

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **Trainer Session Count** | Sessions per trainer over period | `PtSession` | trainer_id, session_count, total_duration | date_range, branch |
| **Commission Summary** | Commission earned by trainer | `TrainerCommission` | trainer_id, amount, currency, status | date_range, branch |
| **Session Completion Rate** | Scheduled vs. completed PT sessions | `PtSession` | status, count | date_range |
| **Trainer Utilization** | Trainer time utilization over period | `PtSession` | trainer_id, booked_hours, available_hours, pct | date_range |

### 6.7 Loyalty Reports

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **Points Issued/Burned** | Loyalty points movements over time | `LoyaltyTransaction` | transaction_type, count, total_points | date_range |
| **Redemption Rate** | Points burned vs. issued ratio | `LoyaltyTransaction` | period, issued, redeemed, rate | date_range |
| **Active Loyalty Accounts** | Account activity over time | `LoyaltyAccount` | status, count | date_range |

### 6.8 AI Usage Reports

*(Data source is the existing `AiUsageRecord` entity, but these are **structured non-AI reports** — they simply aggregate numeric cost/token data, NOT an AI inference)*

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **AI Cost by Operation** | Total cost per AI operation over time | `AiUsageRecord` | operation, total_cost, request_count | date_range |
| **Budget Utilization** | Budget consumed vs. remaining | `AiUsageService` budget state | period, budget, consumed, remaining_pct | date_range |
| **Token Usage Trend** | Total tokens consumed per period | `AiUsageRecord` | period, total_tokens, total_cost | date_range |
| **Top Consumers (Users)** | Users with highest AI consumption | `AiUsageRecord` | user_id, total_requests, total_cost | date_range |

---

## 7. Materialized View Strategy (Phase 6.2 — Stretch Goal)

### 7.1 Rationale

Several report queries (`Revenue Summary`, `Daily Check-ins`, `Member Demographics`, `Avg Workout Duration`) will become expensive as data grows. Materialized views pre-aggregate these into queryable snapshots.

### 7.2 Proposed Views

```sql
-- 1. Daily attendance summary per branch
CREATE MATERIALIZED VIEW reports_mv_daily_attendance AS
SELECT
    organization_id,
    branch_id,
    check_in_time::date AS date,
    COUNT(*) AS total_check_ins,
    COUNT(DISTINCT member_id) AS unique_members,
    AVG(EXTRACT(EPOCH FROM (check_out_time - check_in_time))/60)::int AS avg_duration_minutes
FROM "ATTENDANCE_ATTENDANCE_RECORDS"
WHERE check_out_time IS NOT NULL
GROUP BY organization_id, branch_id, check_in_time::date;

-- 2. Daily revenue summary per organization
CREATE MATERIALIZED VIEW reports_mv_daily_revenue AS
SELECT
    organization_id,
    branch_id,
    invoice_date::date AS date,
    COUNT(*) AS invoice_count,
    SUM(total_amount) AS total_revenue,
    SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) AS collected_revenue,
    -- 'overdue' is derived, never a stored status: non-terminal status AND past due_date.
    -- No grace period by explicit decision — see §6.2.
    COUNT(CASE WHEN status NOT IN ('paid', 'void') AND due_date < now() THEN 1 END) AS overdue_count
FROM "FINANCE_INVOICES"
GROUP BY organization_id, branch_id, invoice_date::date;

-- 3. Membership counts by status and plan
CREATE MATERIALIZED VIEW reports_mv_membership_summary AS
SELECT
    organization_id,
    plan_id,
    status,
    COUNT(*) AS member_count
FROM "MEMBERSHIPS_MEMBERSHIPS"
GROUP BY organization_id, plan_id, status;

-- 4. Daily workout log summary per member
CREATE MATERIALIZED VIEW reports_mv_daily_workouts AS
SELECT
    organization_id,
    member_id,
    session_date::date AS date,
    COUNT(*) AS session_count,
    AVG(duration_minutes)::int AS avg_duration_minutes
    -- No cumulative-volume column: SUM(duration_minutes) was explicitly rejected per Q7 (see src/workouts/entities/workout-session.entity.ts); reinstating it requires an explicit re-decision on Q7 itself, not a silent MV addition.
FROM "WORKOUTS_WORKOUT_SESSIONS"
GROUP BY organization_id, member_id, session_date::date;

-- 5. Monthly member churn per organization
--    "Active in a month" is the §6.1 predicate: the membership's [start_date, end_date]
--    overlaps the month, AND the month does not start after the membership's earliest
--    terminal transition. Churn is attributed per *membership*, not per organization, so a
--    transition can only ever be counted in a month that the membership is actually in.
CREATE MATERIALIZED VIEW reports_mv_member_churn_monthly AS
WITH member_months AS (
    SELECT m.organization_id, m.member_id, m.id AS membership_id,
           date_trunc('month', gs.month)::date AS month
    FROM "MEMBERSHIPS_MEMBERSHIPS" m
    CROSS JOIN LATERAL generate_series(
        date_trunc('month', m.start_date::timestamp),
        date_trunc('month', COALESCE(m.end_date, (now() AT TIME ZONE 'UTC')::date)::timestamp),
        interval '1 month'
    ) AS gs(month)
    WHERE (gs.month + interval '1 month - 1 day')::date >= m.start_date
      AND (m.end_date IS NULL OR gs.month::date <= m.end_date)
      -- Termination cutoff: cancel()/expire never rewrite end_date (§6.1), so the month of
      -- the earliest terminal transition is the last month that counts as active.
      AND gs.month::date <= COALESCE(
            (SELECT MIN(c.occurred_at AT TIME ZONE 'UTC')::date
               FROM "MEMBERSHIPS_MEMBERSHIP_HISTORY" c
              WHERE c.to_status IN ('cancelled', 'expired')
                AND c.membership_id = m.id),
            DATE '9999-12-31')
),
terminated AS (
    SELECT DISTINCT h.membership_id,
           date_trunc('month', h.occurred_at AT TIME ZONE 'UTC')::date AS month
    FROM "MEMBERSHIPS_MEMBERSHIP_HISTORY" h
    WHERE h.to_status IN ('cancelled', 'expired')
)
SELECT a.organization_id, a.month,
       COUNT(DISTINCT a.member_id) AS active_members,
       COUNT(DISTINCT CASE WHEN t.membership_id IS NOT NULL THEN a.member_id END) AS churned_members,
       ROUND(COUNT(DISTINCT CASE WHEN t.membership_id IS NOT NULL THEN a.member_id END)::numeric
             / NULLIF(COUNT(DISTINCT a.member_id), 0) * 100, 2) AS churn_rate_pct
FROM member_months a
LEFT JOIN terminated t
       ON t.membership_id = a.membership_id AND t.month = a.month
GROUP BY a.organization_id, a.month;

-- 6. Monthly active memberships per organization
--    Same §6.1 predicate as #5, so the two views can never disagree about which month a
--    membership belongs to.
CREATE MATERIALIZED VIEW reports_mv_membership_active_monthly AS
SELECT m.organization_id,
       date_trunc('month', gs.month)::date AS month,
       COUNT(DISTINCT m.member_id) AS active_members,
       COUNT(DISTINCT m.id)        AS active_memberships
FROM "MEMBERSHIPS_MEMBERSHIPS" m
CROSS JOIN LATERAL generate_series(
    date_trunc('month', m.start_date::timestamp),
    date_trunc('month', COALESCE(m.end_date, (now() AT TIME ZONE 'UTC')::date)::timestamp),
    interval '1 month'
) AS gs(month)
WHERE (gs.month + interval '1 month - 1 day')::date >= m.start_date
  AND (m.end_date IS NULL OR gs.month::date <= m.end_date)
  AND gs.month::date <= COALESCE(
        (SELECT MIN(c.occurred_at AT TIME ZONE 'UTC')::date
           FROM "MEMBERSHIPS_MEMBERSHIP_HISTORY" c
          WHERE c.to_status IN ('cancelled', 'expired')
            AND c.membership_id = m.id),
        DATE '9999-12-31')
GROUP BY m.organization_id, date_trunc('month', gs.month)::date;

```

### 7.3 Refresh Strategy

| View | Refresh Frequency | Trigger |
|---|---|---|
| `reports_mv_daily_attendance` | Hourly (during operating hours) | Cron worker |
| `reports_mv_daily_revenue` | Every 6 hours + on invoice creation | Cron + outbox event |
| `reports_mv_membership_summary` | Every 6 hours | Cron worker |
| `reports_mv_daily_workouts` | Hourly + on session log | Cron + outbox event |
| `reports_mv_member_churn_monthly` | Daily (off-peak) | Cron worker |
| `reports_mv_membership_active_monthly` | Daily (off-peak) | Cron worker |

> **Design**: Use the existing outbox pattern to enqueue refresh-on-demand: when an attendance/invoice/workout event is published, the outbox handler can trigger a materialized view refresh. However, **do not refresh per-event** — instead debounce to at most once per 5 minutes using a Redis lock. The primary refresh is cron-driven.

> **Note — "on invoice creation" / "on session log" are aspirational today**: the trigger column above describes the intended design, not the current wiring. `EventHandlerRegistry` has exactly **one** registration (`AttendanceEventRecorded.v1` → loyalty), so no handler exists for `MembershipCancelled`/`MembershipExpired`, invoices, or workout sessions. Until those handlers are registered, the two new monthly views and the invoice/workout views refresh on cron only. Registering the membership-terminal handlers is what would let churn update on cancellation rather than waiting for the next cron cycle — it is **not** required for correctness, because a refresh recomputes the whole view from `MEMBERSHIPS_MEMBERSHIP_HISTORY`.

### 7.4 Registration and Refresh Configuration

**Design change (Decision A1)**: materialized views are **registered as rows in the `REPORTS_MATERIALIZED_VIEWS` table (§3.4)**, not declared through an in-code `MaterializedViewConfig` interface. The database is the source of truth for which views exist, so adding or describing a view is a migration + a row, not a shape the application code declares.

| Concern | Where it lives now |
|---|---|
| Which MVs exist | one `REPORTS_MATERIALIZED_VIEWS` row per view |
| Human-readable name / description | `REPORTS_MATERIALIZED_VIEWS.name` / `.description` |
| Last successful refresh | `REPORTS_MATERIALIZED_VIEWS.last_refreshed` (stamped by the refresh worker) |
| Refresh cadence + event trigger | §7.3 table (cron worker / outbox debounce) |
| Debounce window (5 min) | Redis lock, per §7.3 |

The refresh worker treats a `REPORTS_MATERIALIZED_VIEWS` row as its unit of work: resolve the row, run `REFRESH MATERIALIZED VIEW <name>`, then stamp `last_refreshed = now()`. §4.3's endpoints address that same row by `id`; the SQL identifier comes from the row's `name`.

Registration is a migration step — one row per view, using the physical table name (§3.4), and the `name` value must equal the view's SQL identifier exactly:

```sql
INSERT INTO "REPORTS_MATERIALIZED_VIEWS" (name, description)
VALUES
    ('reports_mv_member_churn_monthly',
     'Monthly member churn per organization: active members, churned members and churn rate, bucketed by UTC calendar month.'),
    ('reports_mv_membership_active_monthly',
     'Monthly active membership counts per organization: distinct active members and active memberships, bucketed by UTC calendar month.');
```

The same migration must also register the four §7.2 views once they are implemented; they are omitted here only because their SQL predates this decision and has not yet been reconciled with it.

> **Open gap — cadence columns do not exist**: the DB-plan shape of `REPORTS_MATERIALIZED_VIEWS` is only `id, name, description, last_refreshed`. It has **no** column for refresh cadence, event-trigger flag, debounce seconds, or enabled/disabled — all of which the previous in-code interface carried. Those settings therefore remain in **code/config** (the §7.3 cron schedule and the Redis debounce). If the team wants them runtime-editable, the table must be **extended** with those columns — that is a change to the DB-plan shape and is deliberately **not** made here; it is flagged for a decision.

---

## 8. Export Capability

### 8.1 Supported Formats

| Format | Library | Notes |
|---|---|---|
| CSV | Built-in Node.js stream / manual generation | Simple, universal |
| XLSX | `exceljs` (npm package) | Rich formatting, multi-sheet. Add to package.json at Phase 6 implementation. |

### 8.2 Export Flow

1. Report job completes → result data is in memory as JSON array
2. `ExportService` receives `{ format: 'csv' | 'xlsx', data: Record<string, unknown>[] }`
3. Generates file buffer:
   - **CSV**: Manual generation with header row + escaping
   - **XLSX**: Uses `exceljs` workbook builder. First sheet = data. Adds formatting (bold headers, auto-width, number formatting)
4. Uploads to S3 via existing `S3Service.upload(key, buffer, contentType)`:
   - Key convention: `orgs/{orgId}/reports/{jobId}/report.{csv|xlsx}`
5. Stores `result_s3_key` + `result_s3_bucket` on the job record
6. Client polls job → sees `completed` → shows download link

### 8.3 Download API

```typescript
@Get('/v1/report/jobs/:id/download')
@Header('Content-Type', 'application/octet-stream')
async download(@Param('id') id: string) {
  const job = await this.jobsService.getByIdOrFail(id);
  // Stream from S3 by key; set Content-Disposition with original filename
}
```

> **Gap — new S3 read capability required (not budgeted)**: `src/shared/storage/s3.service.ts`
> currently exposes only `upload()`, `delete()` and `buildKey()`. There is **no** read or
> stream method, so the handler above cannot be implemented as written. A new S3 read/stream
> method must be added in Phase 6, and it is **not currently budgeted** in §2.4 — that
> section's claim that exports "reuse existing `S3Service`" holds for upload only.

---

## 9. Permissions and Authorization

Reuse the existing `@RequirePermission()` decorator pattern.

### 9.1 New Permissions

```typescript
enum ReportPermission {
  REPORT_VIEW     = 'report:view',       // View report catalog + run reports
  REPORT_CREATE   = 'report:create',    // Create custom report schemas
  REPORT_EDIT     = 'report:edit',      // Edit custom report schemas
  REPORT_DELETE   = 'report:delete',    // Delete custom report schemas
  REPORT_EXPORT   = 'report:export',    // Export reports as CSV/XLSX
  DASHBOARD_VIEW  = 'dashboard:view',  // View dashboards
}
```

### 9.2 Seed Permission Assignment

| Role | Permissions |
|---|---|
| `org_admin` | All report permissions |
| `manager` | `REPORT_VIEW`, `REPORT_EXPORT`, `DASHBOARD_VIEW` |
| `trainer` | `REPORT_VIEW`, `DASHBOARD_VIEW` |
| `staff` | `REPORT_VIEW`, `DASHBOARD_VIEW` |
| `member` | None (self-service reports are a Phase 7+ feature) |

---

## 10. Error Handling and Edge Cases

| Scenario | Handling |
|---|---|
| Report execution timeout (>5 min) | Worker marks job as `failed` with timeout error. Recommend the user simplify filters. |
| Empty result set | Job completes normally with `result_rows = 0`. Dashboard shows "No data for selected filters." |
| Export file too large (>100 MB) | **Phase 6.0**: Hard limit of 100 MB. Worker checks estimated size before export. **Phase 6.2**: Streaming export with chunked S3 upload. |
| Pending job count exceeded | An org already holding `MAX_PENDING_JOBS` outstanding `pending` jobs gets `429 Too Many Requests` with the current pending count and a `Retry-After` header. This is a **queue-depth guard, not an execution limit** — see §3.2. |
| Schema not found / org mismatch | Standard 404/403 responses consistent with the rest of the API. |
| S3 download unavailable | API returns `503 Service Unavailable`. Client shows "Report file temporarily unavailable." |
| Schema drift (column no longer exists) | `ReportExecutorService.validate()` runs at execution time, checking column names against current entity metadata. Job fails with descriptive message. |
| Materialized view refresh fails | Logged, retried on next cron cycle. Alert after 3 consecutive failures. |

---

## 11. Migration Plan

### Migration 1: Create `"REPORTS_REPORT_SCHEMAS"` table

```typescript
// 1700000000000-CreateReportSchemasTable.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReportSchemasTable1700000000000 implements MigrationInterface {
  name = 'CreateReportSchemasTable1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "REPORTS_REPORT_SCHEMAS" (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES "TENANCY_ORGANIZATIONS"(id) ON DELETE CASCADE,
        name            VARCHAR(200) NOT NULL,
        description     TEXT,
        category        VARCHAR(50) NOT NULL DEFAULT 'custom',
        query_definition JSONB NOT NULL DEFAULT '{}',
        parameters      JSONB NOT NULL DEFAULT '[]',
        is_system       BOOLEAN NOT NULL DEFAULT FALSE,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_by      UUID REFERENCES "IDENTITY_USERS"(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_report_schemas_org ON "REPORTS_REPORT_SCHEMAS"(organization_id);
      CREATE INDEX idx_report_schemas_category ON "REPORTS_REPORT_SCHEMAS"(category);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "REPORTS_REPORT_SCHEMAS"`);
  }
}
```

### Migration 2: Create `"REPORTS_REPORT_JOBS"` table

```typescript
// 1700000000001-CreateReportJobsTable.ts
// DDL as defined in §3.2
```

### Migration 3: Seed system report schemas

```typescript
// 1700000000002-SeedSystemReportSchemas.ts
// INSERT all predefined reports from §6 into "REPORTS_REPORT_SCHEMAS",
// one row per report, for each organization, or use a DB-level
// post-deployment hook that runs once.
```

---

## 12. Implementation Phasing

This section catalogues the deliverables by phase. Effort estimates are intentionally omitted — they depend on team velocity, feature prioritization, and implementation discoveries. The task codes below are local to this scoping document and should be aligned with the project's task-tracking system during implementation.

### Phase 6.0 — Foundation (Core)

| Task | Dependencies |
|---|---|
| P6-01: `ReportSchema` entity + migration + CRUD service/controller | None |
| P6-02: `ReportJob` entity + migration + job lifecycle service | P6-01 |
| P6-03: Report execution worker + `ReportExecutorService` | P6-02, existing `BackgroundWorker` infra |
| P6-04: CSV/XLSX export service + S3 integration | P6-02, existing `S3Service` |
| P6-05: Report catalog UI (list + create/edit forms) | P6-01 |
| P6-06: Job status viewer + download UI | P6-02, P6-04 |
| P6-07: Seed system report schemas (member, finance, attendance) | P6-01 |

### Phase 6.1 — Dashboards

| Task | Dependencies |
|---|---|
| P6-08: Dashboard hub API + Overview page | P6-06 |
| P6-09: Members/Finance dashboards (w/ recharts) | P6-08 |
| P6-10: Attendance/Workouts dashboards | P6-08 |
| P6-11: Diet/PT dashboards | P6-08 |
| P6-12: AI-usage dashboard | P6-08 |
| P6-13: Date range filter + parameterized dashboard queries | P6-08 |
| P6-14: Reusable `DashboardWidget`, `ChartContainer`, `ExportButton` | P6-08 |
| P6-19: Loyalty dashboard (`apps/web/src/app/reports/dashboards/loyalty/page.tsx`) | P6-08 |

### Phase 6.2 — Performance & Advanced (Stretch)

| Task | Dependencies |
|---|---|
| P6-15: Materialized view migration + refresh worker | P6-03 |
| P6-16: Report scheduling (cron-based auto-execution) | P6-03 |
| P6-17: User favorites / pinning | P6-01 |
| P6-18: `@tanstack/react-table` integration for sort/filter | P6-05 |

---

## 13. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Report queries cause DB performance degradation | Medium | High | Materialized views (Phase 6.2); all report queries have `LIMIT` and `organization_id` scoping; queue-depth limits per org (pending-cap, §3.2) |
| Schema drift between entity definitions and report definitions | Low | Medium | Runtime column validation in `ReportExecutorService`; symbolic column refs (not positional); automated test validates system schemas against entities |
| Export file generation crashes on large datasets | Medium | Medium | Row count check before export; hard file size limit (100 MB); streaming export in Phase 6.2 |
| No email infrastructure for scheduled report delivery | Low | Low | Explicitly deferred to Phase 7. Phase 6 scheduled reports store results in S3; user downloads manually |
| Dashboard load times degrade with many members | Medium | Low | Materialized views absorb query load; dashboards query pre-aggregated MVs (Phase 6.2) or use server-side pagination/limiting |
| Custom report schemas with joins across domains are complex | Medium | Medium | Phase 6.0 supports only single-source queries. Cross-domain query support is Phase 6.2 |

---

## 14. Open Questions (To Resolve in Implementation)

1. **Should custom queries allow cross-source joins?** Current design says no (Phase 6.0 single-source only). For Phase 6.2, consider adding limited join support via predefined relationship paths.
2. **Should the report definition be a structured JSON or a raw SQL template?** This document recommends structured JSON (§3.1.1) for safety. If the team prefers raw SQL for flexibility, the executor must use a safe query builder with parameterized inputs only.
3. **Should materialized views be managed via TypeORM `@Entity` decorators or raw SQL migrations?** Raw SQL migrations are preferred — TypeORM's materialized view support is limited and the refresh logic is custom.
4. **Should S3 download stream be a signed URL or a proxy stream?** Signed URLs are simpler (redirect) but require client-side handling. Proxy streaming keeps the API as the single ingress point but increases server load. This document recommends **proxy streaming** for simplicity and security.
5. **When should the permission seeds for Phase 6 be added?** Add them as part of the existing permission seed migration, or as a new migration that runs after identity/permission setup. Coordinate with the existing `@RequirePermission` decorator pattern.
6. **Is global report-run concurrency = 1 the right v1 baseline?** This is a deliberate first-version scope decision (see §5.1/§5.2), not a property of existing infrastructure: the `BackgroundWorker` base class serializes ticks via its `isRunning` guard (matching the outbox, membership-expiry, and payment-retry workers), so only one report executes at a time. The `WorkerPriority` enum and per-org/global concurrency limits described in earlier drafts do **not** exist in the codebase. If concurrent report execution becomes a requirement, future versions should run multiple worker containers with job-level fencing via the `status` field and a `taken_by` timestamp column. This choice is surfaced here so the project owner can revisit it before or during implementation.

---

## 15. Appendix: Dashboard Wireframes and Component Specifications

### 15.1 Dashboard Hub Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard Hub                       [Date Range] [Export]│
│                                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│  │Members│ │Finance│ │ Attend│ │Workout│ │ Diet │ │  PT  │ │
│  │ 1,234 │ │$45.2K│ │ 156/d │ │ 89/d  │ │ 67%  │ │ 23/w │ │
│  │ ▲ 3.2%│ │ ▼ 1.5%│ │       │ │       │ │adhere│ │      │ │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ │
│                                                         │
│  Recent Reports:                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Revenue Summary — Dec 2026   Completed    Download ▾ │   │
│  │ Active Members — Q4 2026     Running (45%)         │   │
│  │ Check-in Trends — This week  Completed    Download ▾ │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 15.2 Shared UI Components

| Component | Props | Reuse in Existing UI |
|---|---|---|
| `DashboardWidget` | `{title, value, change, icon, href, loading}` | Wraps `Card` + `CardBody` |
| `ChartContainer` | `{title, children, height, exportable}` | Wraps recharts chart, adds export |
| `ReportResultTable` | `{columns, rows, loading, paginated}` | Plain HTML table with CSS |
| `ExportButton` | `{format, onExport}` | Uses `Button` component |
| `ReportJobStatus` | `{jobId, pollInterval, onComplete}` | Shows progress bar + result |

---

## 16. Appendix: Query Definition JSON Examples

### Simple Count Query

```json
{
  "source": "member",
  "columns": {
    "month": "to_char(created_at, 'YYYY-MM')",
    "count": "COUNT(*)"
  },
  "group_by": ["month"],
  "order_by": [{ "column": "month", "direction": "ASC" }],
  "limit": 12
}
```

### Filtered Aggregate Query

```json
{
  "source": "invoice",
  "columns": {
    "status": "status",
    "total": "SUM(total_amount)",
    "count": "COUNT(*)"
  },
  "filters": [
    { "column": "created_at", "operator": "BETWEEN", "value": ["$from", "$to"] },
    { "column": "organization_id", "operator": "=", "value": "$orgId" }
  ],
  "group_by": ["status"],
  "order_by": [{ "column": "total", "direction": "DESC" }]
}
```
