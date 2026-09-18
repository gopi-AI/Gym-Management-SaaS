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
| **AI Usage** (`ai/`) | `AiUsage` | `organization_id` | model, request_type, estimated_cost_usd, token count | total cost, avg cost/request, budget remaining, token trends |

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

> **Known contradiction with §17 (surfaced, not resolved)**: The §17 examples place raw SQL *expressions* in `columns` — e.g. `"COUNT(*)"`, `"SUM(total_amount)"`, and a date-truncation expression. Arbitrary expressions cannot be checked against a column allowlist, so the safety guarantee stated above holds only for plain column references and a fixed set of allowlisted aggregates. Either the executor must restrict `columns` to that subset (in which case the §17 examples must be rewritten to match), or this allowlist guarantee must be explicitly weakened. This is an open decision — it is deliberately left visible here rather than silently dropped.

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

### 3.3 `REPORTS_MATERIALIZED_VIEWS` (in the DB plan as an ERD node only — the migration still has to be written)

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

> **Deferred material moved out of this section**: `REPORTS_USER_REPORT_FAVORITES` is **not** part of the committed Phase 6.0 data model and is no longer listed in §3. It is defined in §15 ("Deferred to Phase 6.2"), so that this section lists committed schema only.

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
| `GET` | `/v1/report/materialized-views` | List materialized views (from `REPORTS_MATERIALIZED_VIEWS` — §3.3) |
| `POST` | `/v1/report/materialized-views/{id}/refresh` | Trigger refresh |
| `GET` | `/v1/report/materialized-views/{id}/data` | Query materialized view |

> `{id}` is `REPORTS_MATERIALIZED_VIEWS.id` (§3.3) — the registry table carried in the DB plan as an ERD node, which Phase 6 must create before these endpoints can resolve anything. The view's SQL identifier is resolved from that row's `name`.

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
| **Membership Status Distribution** | Membership counts by current status — a point-in-time snapshot, not a trend (see note below) | `Membership` | status, count (`COUNT(*)`, `GROUP BY status`) | status, branch |
| **Membership Tenure Distribution** | How long members stay | `Membership` | tenure_months, count | status |

> **Definition — "Active vs. Churned" cannot be a single-source report, and is therefore redefined as a status snapshot (explicit decision)**: the row declares **two** sources, `Membership` + `MembershipHistory`, and asks for `status, month, count`. A month-by-month churn series needs each month's active set joined against its terminal transitions — the same two-table join §7.2 performs in `reports_mv_member_churn_monthly` — and `QueryDefinition` (§3.1.1) declares a **single** `source` with **no** `joins` key, so no seed row can express it. That contract limitation is the one already settled for "Revenue by Plan" (§6.2) and is not re-argued here; what is specific to this row is that no single entity carries a *time-bucketed* status count at all.
>
> **Decision**: the report is redefined as **Membership Status Distribution** over `Membership` alone — `COUNT(*)` grouped by `status`, with no time dimension. `Membership.status` is an app-enforced `varchar(50)` with **no** database `CHECK`, whose value set is `active`, `paused`, `frozen`, `cancelled`, `expired` (`MEMBERSHIP_STATUS`, `src/memberships/services/memberships.service.ts`); the report groups by `status` **as stored** rather than assuming that set is exhaustive. This is the shape §17's own "Filtered Aggregate Query" example already uses (`status` as the group key with `"count": "COUNT(*)"` and `"group_by": ["status"]`). The filter becomes `status, branch` — `Membership.branch_id` is **nullable**, so a branch filter needs a defined bucket for memberships with no branch, exactly as `plan_id` does in §6.2 — while `date_range` is **dropped**, for the reason given next.
>
> **Definition — `date_range` is dropped because honoring it would reintroduce a multi-source dependency, not because a snapshot lacks a time axis (explicit decision)**: the tempting shortcut is to keep `date_range` and reinterpret it as "status as of a past date", reconstructing that status from `Membership`'s own lifecycle columns (`cancelled_at`, `paused_at`, `pause_end_at`, `frozen_at`, `end_date`) instead of the history table. That reconstruction fails, and it fails **asymmetrically** — measured, not assumed. The pause and freeze columns are **current-value columns, cleared on exit**: `transitionState()` sets `paused_at = null` and `pause_end_at = null` on resume and `frozen_at = null` on unfreeze (`src/memberships/services/memberships.service.ts`), so each timestamp survives only while the membership is *still* in that state. In the deployed database, of the **12** memberships that have ever paused and the **8** that have ever frozen, **0** still carry `paused_at` and **0** still carry `frozen_at`, and **2 of the 5** currently-active memberships have a past pause or freeze that `Membership` now shows no trace of. Deriving their status on the date of that pause would return `active` — the opposite of the truth. Expiry is worse: `expireOne()` writes **only** `status = 'expired'` and there is **no** `expired_at` column on `Membership` at all, so an expiry has no instant to reconstruct from — the nearest available date is the contractual `end_date`, which is not when the transition occurred (the worker may drain a backlog well after it). By contrast `cancelled_at` **is** retained and accurate: all 10 currently-cancelled memberships carry it and each matches its history row's `occurred_at` within 5 seconds. So a membership-only derivation would be right for cancellations and silently wrong for every pause and freeze — the worst failure mode, since it looks correct on a spot check. More fundamentally, reading a *current* value back to a *past* date answers "is it paused now?", never the value the membership actually held then. Nor can the history table be substituted as a complete log: **1 of the 15** memberships has **no** history row whatever, because nothing enforces one — the migration defines primary keys and foreign keys only, so no trigger or constraint ties a `status` write to a history insert (and while `MembershipsService.create()` does write a `create` row inside its transaction, a direct SQL insert or import path bypasses it entirely). The honest conclusion is that this row's past-status question is **not single-source from either table**: `Membership` cannot answer it (the evidence is cleared), and `MembershipHistory` cannot cover every membership (no history row is guaranteed). That is a second and stronger reason the row is redefined as a current-state snapshot. A future reader should **not** "restore" `date_range` by repointing the row at `MembershipHistory`; that is only sound once joins land in Phase 6.2 (the Option A / Option C paths above), or once `Membership` records termination immutably — e.g. a never-cleared `terminated_at` plus a status-column audit trail.
>
> **What is genuinely lost**: the **trend**. This report answers "how many memberships are in each status *right now*", not "how did active vs. cancelled/expired change over time". Churn is a *rate over a period* and a snapshot cannot produce one — subtracting one bucket from another (`cancelled` today vs. last month) is not a churn rate, and each bucket is a **point-in-time count, not a cumulative total**. Restoring the trend is Phase 6.2 work of the same kind the §6.2 note names: either **Option A** (extend the executor's `QueryDefinition` with joins — the extension §14/Q1 raises as an open question) or **Option C** (a purpose-built view in §7.2, where `reports_mv_member_churn_monthly` already joins the two tables and already derives `active_members`, `churned_members` and `churn_rate_pct` from them). Until one of those ships, the churn series is **not reportable** under the current contract, and that is stated here rather than implied by a catalog row that cannot be executed.
>
> **The data for that trend is not lost**: `MembershipHistory` still exists and is still written — `MembershipsService.transitionState()` records one row per lifecycle transition **inside the same transaction** as the status change (`from_status`, `to_status`, `transition`, `reason`, `changed_by`) — and `Membership` additionally stores `cancelled_at` and `cancellation_reason` directly. The churn series is therefore computable from data the system is already accumulating; it is simply **not exposed in Phase 6.0's report catalog**, and §7.2's monthly views remain the intended home for it.
>
> **Definition — "right now" is the stored status, not the date window (explicit decision)**: this snapshot reads `Membership.status` as stored and applies **no** date predicate, so a membership whose `end_date` has passed still reports as `active` until the expiry worker transitions it. Expiry is driven by `MembershipExpiryWorker` (hourly, batches of `WORKER_BATCH_SIZES.MEMBERSHIP_EXPIRY`, row-locked, one batch per tick), not by a read-time comparison, so the `expired` bucket lags `end_date` by up to one tick plus any batch backlog. A consumer needing strict "active as of today" semantics must use the monthly predicate below instead, which is deliberately **not** what this row does — the two disagree by construction whenever a membership is past `end_date` but not yet swept.
>
> **Why §7.2's `reports_mv_membership_summary` is *not* used as the source**: the view does cover this measure (`organization_id, plan_id, status, COUNT(*) AS member_count`, grouped by `organization_id, plan_id, status`), so routing through it was evaluated rather than dismissed. It is rejected on three counts. First, §7.2 is **Phase 6.2 — Stretch Goal** scope and its migration is P6-15, also stretch, while no migration creates **any** materialized view today (`pg_matviews` is empty and `grep -rn 'CREATE MATERIALIZED VIEW' src/` returns nothing) — a Phase 6.0 seed row pointing at it would not execute on day one, reintroducing the exact defect this redefinition removes. Second, `ReportExecutorService.validate()` checks columns against **current entity metadata**, and a materialized view has no TypeORM entity, so the contract offers no way to declare one as a `source`; §4.3 addresses views through their own endpoints, never as report sources. Third, the view's group key is finer than this report's (`plan_id` included), so using it would turn the row's `COUNT(*)` into a `SUM(member_count)` roll-up, and its 6-hour refresh (§7.3) would make the snapshot **staler than the table it summarises** — for no gain, since `COUNT(*) GROUP BY status` is already served by an **Index Only Scan** on the existing `IDX_memberships_org_status` index (`organization_id, status`) over a five-value column. The view is therefore left exactly as it was: defined in §7.2, with no Phase 6.0 catalog row depending on it (it has never had a named consumer).
>
> **Definition — the "active in a month" predicate behind the §7.2 monthly views — and behind no Phase 6.0 catalog row, since the snapshot above replaced it — is the `>` boundary, plus a termination cutoff (explicit decision)**: a membership counts as active for a given month if it was active **at any point during that month**. Two conditions produce that set, and both are needed:
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
| **Membership Sales by Plan** | Membership value sold, grouped by plan and currency — contracted value, not collected revenue (see note below) | `Membership` | plan_id, total_value (`SUM(price_at_signup)`), currency_at_signup — `GROUP BY plan_id, currency_at_signup` | date_range |
| **Outstanding Invoices** | Unpaid invoices aging | `Invoice` | invoice_date, due_date, days_overdue (derived, no grace period — `GREATEST(0, EXTRACT(EPOCH FROM (now() - due_date)) / 86400)::int`), amount | branch |
| **Payment Method Mix** | Payment method distribution | `Payment` | payment_method, count, total | date_range |
| **Refund Report** *(not seedable — see note below)* | Refunds over time | `Refund` | refund_date, amount, reason | date_range |

> **Definition — "overdue" has no grace period (explicit decision)**: an invoice counts as overdue the moment `due_date` passes while its status is **non-terminal** (`draft`, `sent`, `partially_paid`). There is no grace window. `overdue` is a **derived condition, never a stored status** — the `FINANCE_INVOICES.status` machine is `draft → sent → partially_paid → paid`, plus `void`, so a `= 'overdue'` predicate would silently match nothing. Adding a grace period later is a **scope change, not a bug fix**.

> **Definition — "Revenue by Plan" cannot be a single-source report, and is therefore redefined (explicit decision)**: no source entity carries both plan identity and money. `Invoice` holds the money (`total_amount`) but has **no** `plan_id` column — it reaches a plan only via the nullable `membership_id`. `InvoiceItem` is the documented second source, but it has **no** plan reference either: its full column set is `id, invoice_id, organization_id, description, quantity, unit_price, line_total, tax_code`. `Membership` holds `plan_id` but no amount (`price_at_signup` is the contracted price at signup, not a billed or collected figure). `MembershipPlan` holds the name but no revenue. Producing "revenue grouped by plan" therefore requires joining `Invoice` → `Membership` → `MembershipPlan` — three hops across **two domains** (finance → memberships).
>
> That is not expressible under the executor's contract: `QueryDefinition` (§3.1.1) declares a **single** `source` and has **no** `joins` key, so no seed row can express those three hops. The surrounding scope statements are consistent with that, but they are **not** worded as a prohibition, and both are scoped to **custom** schemas: §13 lists it as a *Mitigation* for the risk "Custom report schemas with joins across domains are complex" — "Phase 6.0 supports only single-source queries. Cross-domain query support is Phase 6.2" — and §14/Q1 carries it as an **open question**, not a settled decision: "Should custom queries allow cross-source joins? Current design says no (Phase 6.0 single-source only). For Phase 6.2, consider adding limited join support via predefined relationship paths." Extending the contract to support joins in 6.0 is therefore a **scope decision open to revision**, not a blocked path — it is simply not what the executor supports today.
>
> **Decision**: the report is redefined as **Membership Sales by Plan** over `Membership` — `SUM(price_at_signup)` grouped by `plan_id` **and** `currency_at_signup` (see the currency note below). This is a single-source query, so it needs no contract change, and it measures what `Membership` actually records: the **value sold** at signup. It is deliberately **not** labelled "revenue", because it is not collected revenue — it ignores payment status, discounts, and refunds, and it cannot be reconciled against `FINANCE_PAYMENTS`.
>
> **What is genuinely lost**: true *collected revenue* by plan. Reaching it requires a cross-domain join, i.e. **Option A** (extend the executor's `QueryDefinition` to support joins — the extension §14/Q1 raises as an open question and points at Phase 6.2), or **Option C** (a `reports_mv_revenue_by_plan` view in §7.2, which is Phase 6.2 stretch scope and may join freely, as `reports_mv_member_churn_monthly` already joins two tables). Until one of those ships, per-plan collected revenue is **not reportable** under the current contract, and that is stated here rather than implied by a catalog row that cannot be executed.
>
> Two further constraints any future implementation must respect: `Membership.plan_id` is **nullable**, so memberships with no plan need a defined bucket; and `MembershipPlan.name` is a **live** column, so joining to it would label historical sales with the plan's current name — a rename would silently rewrite history. The plan name should instead be resolved at read time (the pattern used in `RetentionService`, which maps `plan_id` → name via a lookup rather than a join), while `plan_id` remains the stable grouping key.
>
> **Definition — "one row per plan" is not guaranteed, because the grouping includes currency (explicit decision)**: `MembershipPlan.currency` is a **live, mutable** column — `UpdateMembershipPlanDto.currency` is an *optional* field on the plan-update path (`PATCH /v1/membership-plans/{id}`, exposed in the plan edit form), and `MembershipPlansService.update()` applies the DTO with no guard on existing memberships, so a plan can be re-denominated **after** memberships have already been sold against it. This is reachable in normal operation, not a theoretical edge case. Because `currency_at_signup` is a snapshot written at signup (`MembershipsService` persists `currency_at_signup: plan.currency`), memberships sold under the superseded currency keep the old value. Grouping by `plan_id, currency_at_signup` therefore returns a plan whose currency changed as **multiple rows — one per currency it was ever sold in**, each carrying its **own partial total**. A plan sold at USD and later changed to EUR returns two rows (for example `USD 40.00` and `EUR 10.00`), not a single row of `50.00`.
>
> This is **correct behaviour, not a defect**: each row's total is genuinely denominated in that row's own currency, and summing rows across currencies is meaningless without an FX conversion at a defined rate and date — which this report does not attempt, and for which Phase 6.0 has no basis. The consequence a consumer must respect is that **`plan_id` alone is not a unique key for this report**: results must be grouped and labelled by `(plan_id, currency_at_signup)` together, and a UI that renders one line per `plan_id` will silently drop or mislabel the rows of any re-denominated plan. Dropping `currency_at_signup` to force one row per plan is explicitly **not** the resolution — it would reintroduce the invalid ungrouped column above and, worse, blend amounts from two currencies into one number. `currency_at_signup` is retained precisely because it is the historical, at-signup fact.
>
> Verified by execution: with a plan sold once at USD (`40.00`) and once at EUR (`10.00`), `GROUP BY plan_id, currency_at_signup` returns exactly two rows (`USD 40.00`, `EUR 10.00`), while the same plan's memberships naïve-summed across both currencies to `50.00`.

> **Definition — the "Refund Report" row is catalogued but not seedable, because its declared source entity does not exist (explicit decision)**: the row declares the source `Refund` with Key Columns `refund_date, amount, reason`. No `Refund` entity exists — `src/**` declares no `Refund` class (the finance module ships `Invoice`, `InvoiceItem`, `Payment`, and `InvoiceNumberCounter` only), and the deployed schema contains no refund table. §1.2's Finance row names both `Refund` and `PaymentAllocation`, and §1.2's preamble asserts that "Every module below has **TypeORM entities + migrations** already deployed" — for these two names that assertion does not hold. Refund support is tracked as a **future** deliverable (P3-02 "Refunds and Credit Notes", docs/task-backlog.md), not as shipped schema.
>
> **Consequence**: this row cannot be seeded. `ReportExecutorService` validates the `source` and its columns against current entity metadata at execution time (§3.1.1, §13), so a seeded `Refund Report` schema would be created successfully and then fail on **every** execution — an `is_system = true` row that can never produce a result. It is therefore excluded from the P6-07 seed set (§12) and from Migration 3's "all predefined reports from §6" (§11), rather than seeded as a row that cannot run.
>
> **This is a different resolution from "Revenue by Plan" and "Active vs. Churned" (§6.1, §6.2), for a specific reason**: those rows were **redefined** to fit the executor's single-source contract because an equivalent single-source shape existed over real columns. No equivalent shape exists here — no deployed entity carries refund data — so the row is **excluded** instead of rewritten. When a `Refund` entity ships (P3-02), this row becomes seedable and rejoins the P6-07 seed set; its source and columns are then determined by that entity, not by this row's current text.
>
> The four other rows in this section (`Revenue Summary`, `Membership Sales by Plan`, `Outstanding Invoices`, `Payment Method Mix`) are unaffected: each declares a single source that exists, with every declared Key Column present on it or derivable from it.

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
| **Most Used Exercise Templates** | Template popularity ranking | `WorkoutSession` | template_id, session_count (`COUNT(*)`, `GROUP BY template_id`) | date_range |

> **Definition — "Most Used Exercise Templates" is redefined over `WorkoutSession`, because its declared source cannot answer the question its own name asks (explicit decision)**: the row declared `Source = WorkoutSessionExercise` with Key Columns `template_name, session_count`. Neither resolves. `WorkoutSessionExercise` has **no `template_name` column and no template reference at all** — its full column set is `id, session_id, exercise_id, sets_completed, reps_completed, weight_used, rpe, notes, created_at` (src/workouts/entities/workout-session-exercise.entity.ts:20-56) — and the row's Description ("Template popularity ranking") is about **templates**, while that entity records **exercises**. Source, columns and description disagreed with each other, and only one of the three could be right.
>
> **Decision**: the report is redefined as a single-source query over `WorkoutSession` — `COUNT(*)` grouped by `template_id` — with the template **name resolved at read time**. This is the pattern §6.2 already uses for `MembershipPlan.name`: `WorkoutSession.template_id` is a real, **nullable** `uuid` column (src/workouts/entities/workout-session.entity.ts:32-33), so it is the stable grouping key, while `WorkoutTemplate.name` is a **live, mutable** column that a rename would silently rewrite — grouping by the name would relabel historical sessions with the template's current name. The name is therefore resolved in the read layer (the `RetentionService` pattern: `id` → label lookup, not a join), and `template_id` remains the grouping key.
>
> **Null `template_id` needs a defined bucket**: it is nullable because a session can be logged without a template (free-form or ad-hoc). Those sessions are grouped under a single explicit "no template" bucket rather than dropped — the same treatment §6.1 gives nullable `branch_id` and §6.2 gives nullable `plan_id`. Dropping them would understate the total and make this ranking's denominator disagree with the §6.4 "Workout Volume" row above it.
>
> **The rejected alternative** was to keep the source as `WorkoutSessionExercise` and change the measure to per-**exercise** popularity (`exercise_id`), which is answerable from that entity as written. It is rejected because it answers a different question than the row's name asks: a reader selecting "Most Used Exercise Templates" would receive exercise counts under a template heading. That measure belongs in its own row if it is wanted, not substituted here.
>
> **The trade-off being accepted, stated so the measure is not misread**: `template_id` is a template *identifier*, so "most used" counts **sessions logged against a template**, not **exercises performed within a session**. Those differ for templates of different sizes — a 12-exercise template and a 3-exercise template each count once per session. That is the correct reading of "template popularity" (how often the template is used), and it is stated here rather than left to be inferred.

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

*(Data source is the existing `AiUsage` entity, but these are **structured non-AI reports** — they simply aggregate numeric cost/token data, NOT an AI inference)*

> **Definition — the §6.8 rows' column names are corrected to the deployed entity's own vocabulary (explicit decision)**: the rows below previously named columns that `AiUsage` does not have. The entity's actual column set is `id, organization_id, user_id, request_type, provider, model, input_tokens, output_tokens, total_tokens, latency_ms, estimated_cost_usd, success, error_code, created_at` (src/ai/entities/ai-usage.entity.ts:18-62). Three of the names the rows used do not appear in it: there is **no `operation` column** (the vocabulary is `request_type`), **no `cost` column** (it is `estimated_cost_usd`), and **no `total_cost` column** (cost is per-request in `estimated_cost_usd`, so any period total is a read-time `SUM`). `ReportExecutorService.validate()` checks column names against current entity metadata (§10), so a row declaring `total_cost` would fail validation on every execution — the same failure mode as P6-21's row. The measures are unchanged; only the names are, and they now match what the entity stores. `user_id` is a real column and is retained.
>
> Note that `AI Cost by Operation`'s **display name** still says "Operation" while its source column is `request_type`; that is a label, not a defect, and it is left as written. `estimated_cost_usd` is **nullable** — it is `NULL` when the request could not be priced — so cost aggregates must state how they treat unpriced rows rather than letting `SUM` drop them silently (the existing `/v1/ai/usage` endpoint documents the same behaviour: "0 when unpriced").

| Report Name | Description | Source | Key Columns | Filters |
|---|---|---|---|---|
| **AI Cost by Operation** | Total cost per AI operation over time | `AiUsage` | request_type, estimated_cost_usd (`SUM`), request_count (`COUNT(*)`) | date_range |
| **Budget Utilization** | Budget consumed vs. remaining | `AiUsageService` budget state | period, budget, consumed, remaining_pct | date_range |
| **Token Usage Trend** | Total tokens consumed per period | `AiUsage` | period, total_tokens (`SUM`), estimated_cost_usd (`SUM`) | date_range |
| **Top Consumers (Users)** | Users with highest AI consumption | `AiUsage` | user_id, total_requests (`COUNT(*)`), estimated_cost_usd (`SUM`) | date_range |

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

**Design change (Decision A1)**: materialized views are **registered as rows in the `REPORTS_MATERIALIZED_VIEWS` table (§3.3)**, not declared through an in-code `MaterializedViewConfig` interface. The database is the source of truth for which views exist, so adding or describing a view is a migration + a row, not a shape the application code declares.

| Concern | Where it lives now |
|---|---|
| Which MVs exist | one `REPORTS_MATERIALIZED_VIEWS` row per view |
| Human-readable name / description | `REPORTS_MATERIALIZED_VIEWS.name` / `.description` |
| Last successful refresh | `REPORTS_MATERIALIZED_VIEWS.last_refreshed` (stamped by the refresh worker) |
| Refresh cadence + event trigger | §7.3 table (cron worker / outbox debounce) |
| Debounce window (5 min) | Redis lock, per §7.3 |

The refresh worker treats a `REPORTS_MATERIALIZED_VIEWS` row as its unit of work: resolve the row, run `REFRESH MATERIALIZED VIEW <name>`, then stamp `last_refreshed = now()`. §4.3's endpoints address that same row by `id`; the SQL identifier comes from the row's `name`.

Registration is a migration step — one row per view, using the physical table name (§3.3), and the `name` value must equal the view's SQL identifier exactly:

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
//
// EXCEPTION — "Refund Report" (§6.2) is deliberately NOT seeded: its declared
// source entity `Refund` does not exist, so a seeded row would pass creation
// and then fail on every execution (ReportExecutorService validates source and
// columns against entity metadata — §3.1.1, §13). See the §6.2 note. The seed
// set is therefore the 12 executable rows of the 13 scoped to P6-07 (§12).
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

> **Definition — P6-07 seeds 12 of the 13 catalog rows in its scope, not 13 (explicit decision)**: its scope is the member, finance, and attendance sections (§6.1 + §6.2 + §6.3 = 13 rows). Twelve pass the executor's contract — a single source entity that exists, with every declared Key Column present on it or derivable from it (§3.1.1) — and **one does not**: **Refund Report** (§6.2), whose source `Refund` does not exist. That row is excluded rather than seeded as a schema that cannot execute; see the §6.2 note. The exclusion is a property of the catalog, not of this task: the seed set is the set of *executable* rows, and it grows by one when a `Refund` entity ships.

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

## 15. Deferred to Phase 6.2 (Not Part of the Committed Phase 6.0 Data Model)

The table in this section is **defined for reference only**. It is **not** part of Phase 6.0's committed data model, **no migration in this phase creates it**, and **no endpoint in §4 reads or writes it**. It ships only if and when **P6-17 (User favorites / pinning)** — the "Phase 6.2 — Performance & Advanced (Stretch)" tier in §12 — is picked up.

It is recorded here, outside §3, so that §3 stays a list of **committed** schema. The deferral is signalled at heading level rather than by a parenthetical on a table heading, matching the convention already used for non-committed material in §7 ("Materialized View Strategy (Phase 6.2 — Stretch Goal)").

### 15.1 `REPORTS_USER_REPORT_FAVORITES`

```sql
CREATE TABLE "REPORTS_USER_REPORT_FAVORITES" (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES "IDENTITY_USERS"(id) ON DELETE CASCADE,
    report_schema_id  UUID NOT NULL REFERENCES "REPORTS_REPORT_SCHEMAS"(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, report_schema_id)
);
```

> **Why deferred rather than merely optional**: the table's only consumer is P6-17, which already sits in the stretch tier — no Phase 6.0 or 6.1 task depends on it, and nothing in `src/` declares it (no entity, no migration). Its FK target `"REPORTS_REPORT_SCHEMAS"` is a committed Phase 6.0 table (§3.1), so the relationship is stable whenever this is built. The table is absent from `docs/database-plan.md`'s ERD; this section is its only definition.

---

## 16. Appendix: Dashboard Wireframes and Component Specifications

### 16.1 Dashboard Hub Layout

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

### 16.2 Shared UI Components

| Component | Props | Reuse in Existing UI |
|---|---|---|
| `DashboardWidget` | `{title, value, change, icon, href, loading}` | Wraps `Card` + `CardBody` |
| `ChartContainer` | `{title, children, height, exportable}` | Wraps recharts chart, adds export |
| `ReportResultTable` | `{columns, rows, loading, paginated}` | Plain HTML table with CSS |
| `ExportButton` | `{format, onExport}` | Uses `Button` component |
| `ReportJobStatus` | `{jobId, pollInterval, onComplete}` | Shows progress bar + result |

---

## 17. Appendix: Query Definition JSON Examples

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
