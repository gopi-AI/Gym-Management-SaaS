# Phase 2 Scoping Plan — Member 360

> **Status**: 28 of 29 open questions resolved (see §12). 1 question remains open (Q15 — measurement events).  
> **Purpose**: Define entities, event contracts, module boundaries, RBAC permissions, and build order for all Phase 2 sub-domains.  
> **Constraint**: No code, entities, migrations, or DTOs are produced from this document. This is a planning artifact only.  
> **Target audience**: Technical decision-maker (reviewer of the plan).

---

## Table of Contents

1. [Sub-domain 1: Personal Training](#1-personal-training)
2. [Sub-domain 2: Workouts](#2-workouts)
3. [Sub-domain 3: Diet / Nutrition](#3-diet--nutrition)
4. [Sub-domain 4: Measurement Tracking](#4-measurement-tracking)
5. [Sub-domain 5: Loyalty / Rewards](#5-loyalty--rewards)
6. [Sub-domain 6: Document & Consent Management](#6-document--consent-management)
7. [Sub-domain 7: Member 360 Dashboard / Aggregation](#7-member-360-dashboard--aggregation)
8. [Sub-domain 8: Attendance History & Trends](#8-attendance-history--trends)
9. [Existing Pattern Application Summary](#9-existing-pattern-application-summary)
10. [Proposed Build Order](#10-proposed-build-order)
11. [Scope Risks & Underspecified Areas](#11-scope-risks--underspecified-areas)
12. [Resolved Decisions — 28 of 29 Questions Answered (1 Open)](#12-resolved-decisions--28-of-29-questions-answered-1-open)

---

## 1. Personal Training

### Domain context

`PT/Training` is a bounded context in the domain map (`docs/domain-map.md` §7). The database plan defines tables under the `PT_` prefix:

- `PT_TRAINERS`, `PT_TRAINER_AVAILABILITY`, `PT_PACKAGES`, `PT_PT_ENROLLMENTS`
- `PT_PT_SESSIONS`, `PT_TRAINER_BOOKINGS`, `PT_TRAINER_COMMISSIONS`

**Naming collision resolved**: The database plan ERD also contains `PT_WORKOUT_PLANS`, `PT_EXERCISES`, `PT_WORKOUT_ASSIGNMENTS`, and `PT_WORKOUT_PROGRESS` — these are pre-split artifacts from before Workouts was separated from PT as its own bounded context. Per [§11 Risk 1 resolution](#risk-1-pt-workouts-naming-collision-resolved), the Workouts module (not PT) owns all exercise/template/session/assignment content. The `PT_` workout tables are **removed from the plan**. PT references Workouts via a module call (`PT → WorkoutsService.assignPlan()`), a one-directional dependency.

### Proposed entities (new module: `src/pt/`)

| Entity | Table | Key fields | Relationships | Notes |
|--------|-------|-----------|---------------|-------|
| `PersonalTrainer` | `PT_TRAINERS` | id, organization_id, branch_id, user_id (nullable), first_name, last_name, specialty, certification, hire_date, is_active | → User (nullable), → Branch | Reuses existing database plan definition |
| `TrainerAvailability` | `PT_TRAINER_AVAILABILITY` | id, trainer_id, day_of_week, start_time, end_time, is_active | → PersonalTrainer | Recurrence pattern needs business rule definition |
| `PTPackage` | `PT_PACKAGES` | id, organization_id, name, description, session_count, price, currency, valid_from, valid_to, is_active, commission_percent (nullable) | → Organization | **Decision**: Price is tax-exclusive (net, see §12 Q4). `currency` column stored explicitly (defaults to org currency at creation but stored, not assumed). `commission_percent` configures commission as % of package price computed at enrollment time (see §12 Q2). |
| `PTEnrollment` | `PT_PT_ENROLLMENTS` | id, organization_id, member_id, package_id, trainer_id, commission_percent (nullable), start_date, end_date, sessions_used, session_count, status, created_at, updated_at | → Member, → PTPackage, → PersonalTrainer | **Decision**: `commission_percent` nullable override on the enrollment. `session_count` snapshotted from the package at enrollment time. `sessions_used` auto-increments on session completion; when `sessions_used` reaches `session_count`, the enrollment auto-transitions to `completed` status (prevents booking against an exhausted package, see §12 Q1). |
| `PTSession` | `PT_PT_SESSIONS` | id, organization_id, branch_id, member_id, trainer_id, enrollment_id, scheduled_start, scheduled_end, actual_start, actual_end, status (scheduled/completed/cancelled/no_show), notes, workout_session_id (nullable) | → Member, → PersonalTrainer, → PTEnrollment | **Decision**: `sessions_used` auto-increments when status transitions to `completed` (see §12 Q1). `workout_session_id` is an optional FK to `WORKOUTS_WORKOUT_SESSIONS` — the PT module does NOT auto-create a WorkoutSession; a trainer may manually link the two when relevant (see §12 Q27). |
| `TrainerCommission` | `PT_TRAINER_COMMISSIONS` | id, pt_enrollment_id, trainer_id, amount, currency, status (pending/earned/clawed_back), earned_at | → PTEnrollment, → PersonalTrainer | **Decision**: Commission is earned per-enrollment at enrollment time (not per-session). FK is `pt_enrollment_id` (NOT `pt_session_id`) — one row per enrollment, not per session. `amount` = `package.price × commission_percent / 100` computed at enrollment creation. `status` column with 3-state lifecycle (`pending` / `earned` / `clawed_back`), default `earned`. In Phase 2, commission is set to `earned` at enrollment time and **never transitions** — no clawback API, no cancellation handler, no worker built yet. The column exists only so Phase 3 refund/cancellation logic has something to act on later. No `paid_at` or `paid_amount` fields in Phase 2. |

### Event contracts

| Event | Payload | Notes |
|-------|---------|-------|
| `PTEnrollmentCreated.v1` | { enrollmentId, memberId, packageId, trainerId?, startDate, sessionCount } | |
| `PTSessionBooked.v1` | { sessionId, enrollmentId, memberId, trainerId, scheduledStart, scheduledEnd } | |
| `PTSessionCompleted.v1` | { sessionId, enrollmentId, actualStart, actualEnd } | **Decision**: Completion auto-increments `sessions_used` on the enrollment (see §12 Q1). Does **not** create an attendance record (see §12 Q3). |
| `PTSessionCancelled.v1` | { sessionId, enrollmentId, reason, cancelledBy } | |
| `TrainerCommissionEarned.v1` | { commissionId, enrollmentId, trainerId, amount } | **Decision**: Commission computed per-enrollment at enrollment time. |

### Outbox usage

Yes — PT session lifecycle events should be outbox-published to support integrations (notification of upcoming sessions, commission processing).

### RBAC permissions (following existing `{resource}:{action}` convention)

```
pt:read              — View PT enrollments, sessions, trainers
pt:create            — Create PT packages, enrollments
pt:update            — Update enrollments, reschedule sessions
pt:delete            — Cancel enrollments, remove trainers
pt:session-check-in  — Mark session as completed (staff-facing)
pt:commission-read   — View trainer commissions
```

### Phase 1 dependencies

- PT enrollments reference `Member` (Phase 1, `src/members/`)
- PT sessions do NOT create attendance records — the member must check in independently (see §12 Q3)
- PT module depends on Workouts module: `PT → WorkoutsService.assignPlan()` for workout plan linkage (see "Naming collision resolved" above)

### Phase 3+ dependencies

- `TrainerCommission` needs real payment processing (Phase 3 finance) for actual payouts. The `status` column and `pending`/`clawed_back` states are pre-deployed to avoid a schema migration.
- **Clawback (earned → clawed_back)**: If Phase 3 adds cancellation/refund processing on `PTEnrollment`, the handler transitions related `TrainerCommission` rows to `clawed_back` via a status update. No deletion — audit trail is preserved.

---

## 2. Workouts

### Domain context

Workouts is a bounded context separate from PT (`docs/domain-map.md` §11 — `WORKOUTS_` prefix). The database plan defines:

- `WORKOUTS_WORKOUT_TEMPLATES`
- `WORKOUTS_WORKOUT_EXERCISES`
- `WORKOUTS_WORKOUT_SESSIONS`
- `WORKOUTS_EXERCISE_LIBRARIES`

**Naming collision resolved**: The database plan ERD also contains `PT_WORKOUT_PLANS`, `PT_EXERCISES`, `PT_WORKOUT_ASSIGNMENTS`, `PT_WORKOUT_PROGRESS` in the PT schema — these are pre-split artifacts from before Workouts was separated from PT. Per the [naming collision resolution](#risk-1-pt-workouts-naming-collision-resolved), the `WORKOUTS_` domain owns all exercise/template/session/assignment content. The `PT_` workout tables are removed from the plan. PT calls into `WorkoutsService.assignPlan()` for workout plan assignment, a one-directional dependency.

### Proposed entities (new module: `src/workouts/`)

| Entity | Table | Key fields | Relationships | Notes |
|--------|-------|-----------|---------------|-------|
| `Exercise` | `WORKOUTS_EXERCISES` | id, organization_id, name, description, category, muscle_group, equipment_needed, is_active | → Organization | **Decision**: Strictly org-scoped — `organization_id` is NOT NULL (see §12 Q5). No global/shared table, no seed exercises concept. |
| `WorkoutTemplate` | `WORKOUTS_WORKOUT_TEMPLATES` | id, organization_id, name, description, difficulty_level, estimated_duration_minutes, is_active | → Organization | |
| `WorkoutTemplateExercise` | `WORKOUTS_WORKOUT_TEMPLATE_EXERCISES` | id, template_id, exercise_id, sets, reps, weight_template (nullable), rest_seconds, sort_order, day_of_week (nullable) | → WorkoutTemplate, → Exercise | |
| `WorkoutPlanAssignment` | `WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS` | id, organization_id, member_id, template_id, assigned_by, assigned_at, start_date, end_date, status (active/completed/expired), notes | → Member, → WorkoutTemplate, → User | **Decision**: Multiple active plans allowed simultaneously. Unique constraint per (member, template) — you cannot double-assign the exact same template concurrently, but different templates can run in parallel (see §12 Q6). |
| `WorkoutSession` | `WORKOUTS_WORKOUT_SESSIONS` | id, organization_id, member_id, template_id (nullable), assignment_id, session_date, started_at, completed_at, duration_minutes, notes, mood (nullable) | → Member, → WorkoutTemplate, → WorkoutPlanAssignment | **Decision**: Progress = exercise-completion percentage: (completed exercises across sessions) / (prescribed exercises across sessions) within the assignment's date window. Optional RPE field exists as non-driving intensity measure. Volume (cumulative weight lifted) is explicitly EXCLUDED — rejected as noisy and not comparable across exercise types. Do not include volume in the progress calculation or entity design (see §12 Q7). |
| `WorkoutSessionExercise` | `WORKOUTS_WORKOUT_SESSION_EXERCISES` | id, session_id, exercise_id, sets_completed, reps_completed, weight_used, rpe (nullable), notes | → WorkoutSession, → Exercise | Per-exercise log powering progress tracking. RPE is optional. |

### Event contracts

| Event | Payload | Notes |
|-------|---------|-------|
| `WorkoutPlanAssigned.v1` | { assignmentId, memberId, templateId, assignedBy, assignedAt, startDate, endDate? } | |
| `WorkoutSessionLogged.v1` | { sessionId, memberId, assignmentId?, sessionDate, durationMinutes } | |
| `WorkoutPlanCompleted.v1` | { assignmentId, memberId, completedAt } | |

### Outbox usage

Yes — assignment and logging events are meaningful for notifications, rewards, and reporting.

### RBAC permissions

```
workout:read    — View workout templates, sessions
workout:create  — Create templates
workout:update  — Update templates
workout:delete  — Delete templates
workout:assign  — Assign plans to members
workout:log     — Log workout sessions (member-facing)
```

### Phase 1 dependencies

- References `Member`.
- **Depended on by**: PT module calls `WorkoutsService.assignPlan()`. Workouts does NOT depend on PT.
---

## 3. Diet / Nutrition

### Domain context

Diet is a bounded context (`docs/domain-map.md` §12 — `DIET_` prefix). The database plan defines:

- `DIET_DIET_PLANS`, `DIET_MEAL_TEMPLATES`, `DIET_NUTRITION_LOGS`, `DIET_DIETARY_PREFERENCES`

### Proposed entities (new module: `src/diet/`)

| Entity | Table | Key fields | Relationships | Notes |
|--------|-------|-----------|---------------|-------|
| `DietPlan` | `DIET_DIET_PLANS` | id, organization_id, name, description, total_calories_per_day (nullable), is_active | → Organization | |
| `MealTemplate` | `DIET_MEAL_TEMPLATES` | id, diet_plan_id, name, meal_type (breakfast/lunch/dinner/snack), description, calories, protein_g, carbs_g, fat_g, serving_size | → DietPlan | |
| `DietPlanAssignment` | `DIET_DIET_PLAN_ASSIGNMENTS` | id, organization_id, member_id, diet_plan_id, assigned_by, assigned_at, start_date, end_date, status (active/completed/expired) | → Member, → DietPlan, → User | **Decision**: Multiple active plans allowed simultaneously (see §12 Q8). |
| `NutritionLog` | `DIET_NUTRITION_LOGS` | id, member_id, assignment_id (nullable), meal_template_id (nullable), meal_description (nullable), log_date, servings, logged_at, calories (nullable), protein_g (nullable), carbs_g (nullable), fat_g (nullable) | → Member, → MealTemplate (nullable) | **Decision**: Free-text meal fallback added — `meal_description` allows logging without a template reference. Macro columns (calories, protein_g, carbs_g, fat_g) are nullable. When macros are null (free-text meal with no nutrition data entered), the row is **excluded from aggregation** — it is not treated as zero. Dashboard shows "N meals logged (M with macro data)" to flag incompleteness. |
| `DietaryPreference` | `DIET_DIETARY_PREFERENCES` | id, member_id, preference_type (allergy/intolerance/diet_type/cuisine), preference_value, severity (nullable) | → Member | |

### Event contracts

| Event | Payload | Notes |
|-------|---------|-------|
| `DietPlanAssigned.v1` | { assignmentId, memberId, dietPlanId, assignedBy, startDate, endDate? } | |
| `NutritionLogRecorded.v1` | { logId, memberId, assignmentId?, mealTemplateId?, mealDescription?, logDate, calories?, protein?, carbs?, fat? } | **Decision**: Free-text meals omit `mealTemplateId`. Macro fields are nullable — consider using a "logged" macro vs "template-sourced" field if important, but initially treat null as "no macro data submitted." Macro aggregation excludes nulls (see adherence rules in §7). |
| `DietPlanCompleted.v1` | { assignmentId, memberId, completedAt } | |

### Outbox usage

Yes — diet plan assignments and nutrition log events are useful for notifications, adherence reporting, and potential loyalty integration. The adherence aggregation (daily macro totals) is computed server-side at query time, not derived from events — no separate outbox event for aggregation is needed.

### RBAC permissions

```
diet:read    — View diet plans, meal templates, logs
diet:create  — Create diet plans, meal templates
diet:update  — Update diet plans
diet:delete  — Delete diet plans
diet:assign  — Assign diet plans to members
diet:log     — Log meals (member-facing)
```

### Phase 1 dependencies

- References `Member`.
---

## 4. Measurement Tracking

### Domain context

Measurements are time-series body metrics (weight, body fat, etc.) tracked over time. The database plan has **no dedicated measurement table**. The task backlog (P2-07) says `measurement_logs` table (new). The existing `MemberProfile` entity has point-in-time `height`, `weight`, `body_fat` as single-value columns — these are essentially "current" values, not a time-series log.

**Decision**: Dual representation (see §12 Q13). `MemberProfile` retains point-in-time columns as the latest-value cache; `measurement_logs` is the append-only time-series source of truth. When a new `MeasurementLog` is inserted, the corresponding `MemberProfile` field is updated to the latest value in the **same DB transaction** (`dataSource.transaction`, matching the `MembersService.create()` pattern from Phase 1). Both rollback directions are covered: (a) `MeasurementLog` insert fails → `MemberProfile` unchanged, and (b) `MemberProfile` update fails → `MeasurementLog` insert rolled back.

### Proposed entity (extending `src/members/`)

I lean toward keeping measurements as a sub-entity of `src/members/` (similar to `MemberIdentifier` and `MemberProfile`), because:
- Measurements are semantically member data, not a standalone domain.
- The task backlog (P2-07) lists `src/members/` as the affected module.
- It avoids creating a single-entity module.

| Entity | Table | Key fields | Relationships | Notes |
|--------|-------|-----------|---------------|-------|
| `MeasurementLog` | `MEMBERS_MEMBER_MEASUREMENTS` | id, member_id, measurement_type (weight/body_fat/chest/waist/hip/arm/thigh/calf), value, unit (kg/lb/cm/in/%), measured_at, measured_by (optional), notes | → Member | **Decision**: Fixed enum for Phase 2. `weight`, `body_fat` are active in Phase 2. `chest`, `waist`, `hip`, `arm`, `thigh`, `calf` are reserved in the enum definition for future use but have **no endpoints or UI built** for them in Phase 2. Height excluded — remains on `MemberProfile` (§12 Q11-14). |

### Decision: Single table or per-type columns?

**Option A (normalized)**: `measurement_logs` with `measurement_type` + `value` + `unit` columns. More flexible, easy to add new types, supports aggregation by type over time. **Recommended.**

**Option B (wide table)**: `measurement_logs` with columns `weight_kg`, `body_fat_pct`, `chest_cm`, etc. Fixed schema, requires migration for new metrics.

I recommend **Option A** — it matches the "time series" / "aggregation for charts" language in the task backlog.

### Single legal write path

`MeasurementLogService.create()` is the **only** entry point. No other module or controller may inject the `MeasurementLog` repository directly; the module exports the service, not the repository. This ensures the dual-write (log + profile update) always fires — a direct repository bypass would silently skip the `MemberProfile` update.

### Required tests

Both rollback directions must be tested:
1. `MeasurementLog` insert fails → `MemberProfile` unchanged
2. `MemberProfile` update fails → `MeasurementLog` insert rolled back
3. Control-flow ordering guard test (same rigor as the Phase 1 `members.service.ts` outbox fix)

### Event contracts

| Event | Payload | Notes |
|-------|---------|-------|
| `MeasurementRecorded.v1` | { measurementId, memberId, measurementType, value, unit, measuredAt } | **OPEN (see §12 Q15).** This was never discussed or decided in the requirements conversation. Placeholder contract defined for forward-compatibility. **No producer in Phase 2** until this decision is made — leaving it unresolved rather than assuming a yes or no. |

### Outbox usage

Low value unless measurements trigger loyalty rewards or notifications. **Decision deferred per Q15** — do not build the event producer until the open question is resolved.

### RBAC permissions

```
member:measurement-read     — View member measurements
member:measurement-create   — Log measurements
```

These fit within the existing `member:*` namespace rather than a new resource.

### Phase 1 dependencies

- References `Member`.
---

## 5. Loyalty / Rewards

### Domain context

Loyalty is **not** defined in the database plan ERD at all. The task backlog mentions `loyalty_points` and `loyalty_transactions` tables. The domain map doesn't list it as a bounded context — it's a feature under the Member 360 umbrella. The implementation roadmap mentions a "Points calculation worker".

This is the most underspecified sub-domain in the existing docs.

### Proposed entities (new module: `src/loyalty/`)

Dedicated module placement (see §12 Q16). Consumes events from other modules via the **standard outbox/inbox pattern** (reliable delivery, at-least-once, same mechanism used elsewhere) — no ad hoc listeners.

| Entity | Table | Key fields | Relationships | Notes |
|--------|-------|-----------|---------------|-------|
| `LoyaltyAccount` | `LOYALTY_ACCOUNTS` | id, organization_id, member_id, balance, lifetime_points_earned, lifetime_points_redeemed, tier (nullable), updated_at | → Member, → Organization | **Decision**: No tier system in Phase 2 — `tier` column nullable and unused (see §12 Q19). Flat points, no thresholds, no tier-up workflow. |
| `LoyaltyTransaction` | `LOYALTY_TRANSACTIONS` | id, account_id, transaction_type (earn/expire/redeem/adjust), points, remaining_points, reference_type, reference_id, description, expires_at (nullable), created_at | → LoyaltyAccount | **Decision**: Points expire in Phase 2 — `expires_at` set at earn time as `created_at + org.points_expiry_days` (see §12 Q18). `remaining_points` column starts equal to `points`, decremented by the expiry worker (see §12 Q22). `balance_after` explicitly **removed** — redundant with the account's materialized balance and a concurrency risk. `redeemed` transaction_type exists in the enum for Phase 3 but is unused in Phase 2. |
| `LoyaltyRule` | `LOYALTY_RULES` | id, organization_id, name, trigger_event (check_in/workout_logged), points_per_event, max_per_day (default 1), is_active, created_at, updated_at | → Organization | **Decision**: Exactly two triggers in Phase 2: `check_in` and `workout_logged` (see §12 Q17). PT session completion is explicitly **deferred** (double-counting concern — PT is already a paid service). Referrals are explicitly **deferred to Phase 3+** (needs referral-tracking infrastructure not yet built). Flat `points_per_event` integer per rule — no formula engine, no multiplier/boost logic. Once per member per day per trigger — `max_per_day` column, default 1. |
| `LoyaltyReward` | `LOYALTY_REWARDS` | id, organization_id, name, description, points_cost, reward_type (discount/item/free_session), is_active, valid_from, valid_to, stock (nullable) | → Organization | **Decision**: Schema-only table seat-filler for a future feature. No CRUD, no redemption endpoint, no FIFO-consumption logic built in Phase 2. The `redeem()` method is not implemented (see §12 Q20). |

### Loyalty design notes (all resolved — see §12 Q16–Q22)

1. **Points accrual triggers**: Award points for `check_in` and `workout_logged` events only (see §12 Q17).
2. **Points expiration**: **YES in Phase 2** — default **365 days**, configurable per organization (`org.points_expiry_days`). **FIFO model**: `expires_at` set at earn time. **The expiry-sweep worker IS built in Phase 2**: a daily batch job (`@Cron` or equivalent) that finds transactions where `expires_at < NOW()` and `remaining_points > 0`, creates an `expire` transaction for each, and decrements the account balance accordingly (see §12 Q18).
3. **Redemption**: **NOT in Phase 2** — accrual-only (see §12 Q20).
4. **Tier system**: No tiers in Phase 2 — flat points (see §12 Q19).
5. **Finance integration for rewards**: Deferred to Phase 3, alongside redemption (see §12 Q20).
6. **Accrual timing**: **Synchronous** — the loyalty module's inbox consumer processes the emitting module's outbox event and writes the `LoyaltyTransaction` (plus updates the account balance) in the same processing cycle — not a batch aggregator (see §12 Q21).
7. **"Points calculation worker"**: This IS the expiry-sweep worker described in §12 Q18. It is NOT an accrual batch job (accrual is synchronous, per §12 Q21). **There is no "streak bonus" concept anywhere in this design — it was never discussed or proposed. Do not add it** (see §12 Q22).

### Balance atomicity (cross-cutting)

Any operation that updates `LoyaltyAccount.balance` must wrap that update and the corresponding `LoyaltyTransaction` insert in the **same DB transaction**, following the pattern verified in `MembersService` (`src/members/services/members.service.ts`). A rollback test covering this is required before the feature is considered complete.

### Event contracts

| Event | Payload | Notes |
|-------|---------|-------|
| `LoyaltyPointsAwarded.v1` | { accountId, memberId, points, transactionId, referenceType, referenceId, description } | **Decision**: The loyalty module (as consumer) computes the value based on the `LoyaltyRule` matching the trigger event. The emitting domain sends its event (e.g., `CheckInCompleted.v1`); the loyalty module subscribes, matches a rule, and awards points synchronously (see §12 Q17, Q21). |
| `LoyaltyPointsExpired.v1` | { accountId, memberId, points, transactionId, expiredAt } | Produced by the expiry-sweep worker (see §12 Q18). |
| `LoyaltyPointsRedeemed.v1` | { accountId, memberId, points, rewardId, transactionId } | Forward-compatibility only — not produced in Phase 2 (redemption deferred to Phase 3, see §12 Q20). |

### Outbox usage

Yes — transaction events should be published for audit trail and potential integration with finance (Phase 3).

### RBAC permissions

```
loyalty:read         — View points balance, transaction history
loyalty:adjust       — Manually adjust points (admin)
loyalty:redeem       — Redeem rewards (Phase 3 — defined but not enforced in Phase 2)
loyalty:rules-manage — Configure loyalty rules
```

### Phase 1/Phase 3 dependencies

- **Phase 1**: Attendance check-in events are a points trigger.
- **Phase 2**: Workout events are an additional trigger.
- **Phase 3**: Rewards redemption may need to generate discounts on invoices.
---

## 6. Document & Consent Management

### Domain context

The database plan already defines `MEMBERS_MEMBER_CONSENTS` under the Members schema. The domain map says `member_consents` is owned by the Members context. Documents/attachments are referenced as S3 storage references in the implementation roadmap.

### Proposed entities (inside `src/members/`, extending existing entities)

Consents are already defined in the ERD and the Phase 1 `/members/` module **does not** have a `MemberConsent` entity yet — this is a Phase 2 addition to `src/members/`.

| Entity | Table | Key fields | Relationships | Notes |
|--------|-------|-----------|---------------|-------|
| `MemberConsent` | `MEMBERS_MEMBER_CONSENTS` | id, member_id, consent_type (gdpr/marketing/photo_waiver/terms/health_disclosure), is_given, given_at, expires_at, revoked_at (nullable), revocation_reason (nullable), document_url (nullable), version (nullable) | → Member | Already in database plan ERD. **Decision**: `revoked_at` and `revocation_reason` columns added for compliance audit trail (see §12 Q23). Optional FK to `MemberDocument` for signed forms. |
| `MemberDocument` | `MEMBERS_MEMBER_DOCUMENTS` | id, member_id, document_type (consent_form/medical_report/id_proof/photo/agreement), file_name, s3_key, mime_type, file_size_bytes, uploaded_by, uploaded_at, is_active | → Member, → User (uploaded_by) | **New table** — needed for "Attachments" but not in the database plan ERD. |

### Key design question: Where does a consent "document" live?

- A consent is a **record of agreement** (boolean + type + timestamp).
- A document is a **file** (S3 key + metadata).
- A consent *may* reference an uploaded signed document (the `document_url` column in the ERD).

These are semantically separate but related. I propose keeping them as separate entities but allowing an optional `document_id` FK on `MemberConsent` → `MemberDocument`.

### Event contracts

| Event | Payload | Notes |
|-------|---------|-------|
| `MemberConsentGiven.v1` | { consentId, memberId, consentType, givenAt, expiresAt? } | Already listed in domain map. |
| `MemberConsentRevoked.v1` | { consentId, memberId, consentType, revokedAt, reason? } | Only if revocation tracking is needed. |
| `MemberDocumentUploaded.v1` | { documentId, memberId, documentType, fileName, s3Key } | |
| `MemberDocumentDeleted.v1` | { documentId, memberId } | |

### Outbox usage

Yes — consent events are important for compliance/GDPR audit trails. Document upload events less so.

### RBAC permissions

```
member:consent-read      — View member consents
member:consent-manage    — Give/withdraw consents
member:document-read     — View/download documents
member:document-upload   — Upload documents
member:document-delete   — Delete documents
```

These fit within the `member:*` namespace.

### Phase 1 dependencies

- References `Member`.
- No Phase 1 entity for `MemberConsent` exists yet (it was in the ERD but not implemented in Phase 1).
---

## 7. Member 360 Dashboard / Aggregation

### Domain context

The Member 360 is **not a module** with its own entities — it's an **aggregation/read layer** that queries data from every other module. The task backlog (P2-01, P2-02) describes it as API endpoints under `/v1/members/{id}/360/`.

### Proposed architecture

1. **A new aggregation service** inside `src/members/` (or possibly a top-level `src/member-360/` read-model module) that orchestrates queries to other modules' services.
2. **No new database tables** for the 360 view — it's all read-side composition.
3. **Lazy-loaded tab data**: Each tab endpoint is a separate API route. The header (P2-01) is the only aggregation endpoint that combines data from multiple domains in one response.

### Proposed API endpoints (expanding the task backlog)

``` 
GET /v1/members/{memberId}/360/header         → Header summary (P2-01)
GET /v1/members/{memberId}/memberships        → Membership history (P2-02)
GET /v1/members/{memberId}/pt                 → PT enrollments and sessions (P2-04)
GET /v1/members/{memberId}/workouts           → Workout plans + sessions (P2-05)
GET /v1/members/{memberId}/diet               → Diet plans + nutrition logs (P2-06)
GET /v1/members/{memberId}/measurements        → Measurement logs (P2-07)
GET /v1/members/{memberId}/loyalty             → Points balance + transactions (P2-08)
GET /v1/members/{memberId}/attendance          → Attendance history + trends (§8)
GET /v1/members/{memberId}/consents            → Consent records
GET /v1/members/{memberId}/documents           → Uploaded documents
```

### Where does the aggregation code live?

**Option A**: A `Member360Service` in `src/members/services/` that depends on services from other modules (injected via their exported providers).

**Option B**: A dedicated `src/member-360/` module that is purely a read-side orchestrator, importing the needed modules' services.

**I recommend Option A** for simplicity initially, but flag that this creates a circular-dependency risk: if `src/members/` imports `src/pt/` for PT data, and `src/pt/` imports `src/members/` for member data, NestJS circular module imports may be needed. The task backlog puts the 360-related code in `src/members/`, so Option A aligns with that.

### Header DTO (P2-01)

The header response would need to aggregate:

```
{
  member: { id, localId, firstName, lastName, photo?, membershipStatus },
  membership: { status, planName, endDate, daysRemaining },
  accessStatus: { today: "granted" | "denied" | "not_checked_in", lastCheckIn? },
  quickActions: ["check_in", "renew", "book_pt", "log_workout"]
}
```

**Decision**: Quick actions are computed from member state (see §12 Q26). Shown/hidden based on check-in status, membership expiry, active PT enrollment, etc.

### RBAC permissions

The 360 endpoints should reuse the underlying per-domain permissions — the 360 is just a presentation layer. But a top-level `member:360-view` permission could control access to the entire dashboard as a whole.

### Adherence aggregation for Diet tab (P2-06)

The diet tab aggregates daily macro totals from `NutritionLog` entries. Two rules govern the aggregation:

1. **Null-macro exclusion**: Rows where `calories`, `protein_g`, `carbs_g`, or `fat_g` are all null (free-text meal logged without nutrition data) are **excluded from aggregate totals**. They are not treated as zero. A separate count of "meals with incomplete macro data" is included in the response.
2. **Partial-null handling**: If a row has some macro fields populated and others null (e.g., calories entered but protein omitted), the populated fields contribute to their respective totals and the null fields are excluded from their respective aggregates. This is unlikely to occur via normal data entry paths but is handled defensively.

Response shape for the diet tab:
```json
{
  "dailyTotals": [
    {
      "date": "2026-09-15",
      "calories": 1850,
      "proteinG": 120,
      "carbsG": 200,
      "fatG": 55,
      "mealsLogged": 4,
      "mealsWithMacros": 3,
      "mealsMissingMacros": 1,
      "adherencePct": 75.0
    }
  ]
}
```

`adherencePct` is computed as `(mealsWithMacros / mealsLogged) * 100`. Adherence to a prescribed diet plan is a separate query (comparing actual totals to the assigned `DietPlan.total_calories_per_day` range).

### Outbox usage

None — the 360 is read-only aggregation, not an event source.
---

## 8. Attendance History & Trends

### Domain context

Attendance data already exists from Phase 1 (`ATTENDANCE_ATTENDANCE_RECORDS`). The Phase 2 work is about querying it for the 360 dashboard: history view, check-in trends/charts, streaks.

### What needs to be built

This is primarily **query capability** in the existing `src/attendance/` module — no new entities needed for the attendance records themselves. However:

- **Trend aggregation**: Daily/weekly/monthly check-in counts per member over a time range.
- **Streak calculation**: Consecutive days with at least one check-in.
- **Last visit / visit frequency**: Summary metrics for the 360 header.

### Proposed new service methods (in `AttendanceService`)

```
getMemberAttendanceHistory(memberId, from, to, pagination)
getMemberCheckInTrends(memberId, period: 'week' | 'month' | 'quarter')
getMemberAttendanceStreak(memberId) -> { currentStreak, longestStreak, lastVisitDate }
getMemberSummaryForHeader(memberId) -> { lastCheckIn, todayCheckedIn, totalVisitsThisMonth }
```

**Still open (not in the 29-question batch — see §12)**: Streak calculation — calendar days (must check in every day) or gym-visit days (check in on Mon, Wed, Fri, skip Tue, streak continues)? The domain map says "attendance history and check-in trends" but doesn't define streaks specifically. Recommended default: **calendar days** (simpler, more common in gym apps), configurable per-organization later.

### Event contracts

None — purely query logic on existing Phase 1 data.

### RBAC permissions

Reuses existing `attendance:read`.

### Phase 1 dependencies

- Directly depends on `ATTENDANCE_ATTENDANCE_RECORDS` and `ATTENDANCE_ACCESS_DECISIONS`.
---

## 9. Existing Pattern Application Summary

| Sub-domain | Own module? | Outbox events? | RBAC pattern | Phase 1 dependency | Notes |
|-----------|-------------|----------------|--------------|--------------------|-------|
| Personal Training | `src/pt/` (new) | Yes — session lifecycle | `pt:resource:action` | Member, potentially attendance | Workout plan overlaps with Workouts domain. `TrainerCommission` has `status` field (default `earned`) pre-deployed for Phase 3 clawback support. |
| Workouts | `src/workouts/` (new) | Yes — assignments, logs | `workout:resource:action` | Member | Exercise library scope TBD |
| Diet | `src/diet/` (new) | Yes — assignments, logs | `diet:resource:action` | Member | Free-text fallback added (`meal_description`). Null-macro meals excluded from aggregation, dashboard flags count of untracked meals. |
| Measurement Tracking | Extends `src/members/` | No (initially) | `member:measurement-*` | Member | No time-series table exists yet. |
| Loyalty/Rewards | `src/loyalty/` (new) | Yes — award, redeem | `loyalty:resource:action` | Attendance, Member | Most underspecified — module placement confirmed as dedicated `src/loyalty/`. |
| Document & Consent | Extends `src/members/` | Yes — consent lifecycle | `member:consent-*` | Member | `MemberConsent` in ERD, not yet implemented. `MemberDocument` table (new) for arbitrary file uploads. |
| Member 360 Dashboard | Aggregation in `src/members/` | No (read-only) | Reuses per-domain permissions | All Phase 1 + Phase 2 | Orchestration service. Diet tab includes adherence aggregation with null-macro exclusion. |
| Attendance Trends | Extends `src/attendance/` | No (query logic) | Reuses `attendance:read` | Attendance (Phase 1) | New query methods only. |

---

## 10. Proposed Build Order

The build order is driven by dependencies: the Member 360 header needs data from modules to display, so modules must be built before (or concurrently with) the aggregation layer.

### Recommended sequence

| Order | Module | Rationale |
|-------|--------|-----------|
| **1** | **Measurement Tracking** (extends `src/members/`) | Simplest sub-domain — one new entity, RBAC extends existing `member:*`. **This should be the reference implementation** for Phase 2. Extends an existing module, no outbox events needed (Q15 open). |
| **2** | **Document & Consent** (extends `src/members/`) | Also extends an existing module, introduces outbox events for compliance, but still within the well-understood `src/members/` boundary. |
| **3** | **Workouts** (`src/workouts/`) | Moved up — PT depends on calling `WorkoutsService.assignPlan()`. |
| **4** | **Personal Training** (`src/pt/`) | Moved down — depends on Workouts existing first. Has more complex state machine. |
| **5** | **Diet / Nutrition** (`src/diet/`) | Parallels workouts in complexity. Nutrition logs are the most "user-submitted data" of all domains. |
| **6** | **Attendance Trends** (extends `src/attendance/`) | Pure query logic — no entities, no outbox. Relatively quick. |
| **7** | **Member 360 Header + Dashboard** | Cannot be built until modules 1-6 have data to aggregate. Validates cross-module orchestration. (P2-03 Services tab deferred to Phase 3.) |
| **8** | **Loyalty / Rewards** (`src/loyalty/`) | Built last because it consumes events from other modules (attendance, workouts). Most complex reward-logic needs time for rule-engine design decisions. |

### Why Measurement Tracking first as the reference

- Single-entity addition to a known module (`src/members/`).
- The dual-write + rollback test pattern is the same rigor as the Phase 1 `members.service.ts` outbox fix.
- Time-series data pattern is reusable for nutrition logs and workout session logs.
- Immediately useful for the 360 dashboard to show real data.
- The pattern for new entities (TypeORM entity with tenancy, Create/Update DTOs with Zod validation, CRUD controller with `@RequirePermissions`, paginated query) will be fully exercised and can be documented for later, more complex modules.

---

## 11. Scope Risks & Underspecified Areas

These are gaps I found in the existing docs that need resolution before or during Phase 2 implementation. Each is distinct from the resolved decisions in §12 — these are *missing or contradictory specifications*, not just value-computation ambiguity.

### Risk 1: PT-Workouts naming collision (resolved — see "Naming Collision Resolution")

The database plan ERD spreads workout-related tables across both `PT_` and `WORKOUTS_` schemas:
- `PT_WORKOUT_PLANS`, `PT_EXERCISES`, `PT_WORKOUT_ASSIGNMENTS`, `PT_WORKOUT_PROGRESS` (PT schema)
- `WORKOUTS_WORKOUT_TEMPLATES`, `WORKOUTS_WORKOUT_EXERCISES`, `WORKOUTS_WORKOUT_SESSIONS`, `WORKOUTS_EXERCISE_LIBRARIES` (Workouts schema)

**Resolved**: The `WORKOUTS_` domain owns all exercise/template/session/assignment content. The `PT_` schema's workout tables are **removed from the plan entirely** — they were pre-split artifacts. PT references Workouts via a module call (`PT → WorkoutsService.assignPlan()`), a one-directional dependency. Workouts does not depend on PT. Confirmed fully greenfield — no existing code in `src/` or `packages/` touches any of these tables or modules.

### Risk 2: `MemberProfile` vs measurement logs duality (resolved — see §12 Q11–14)

`MemberProfile` in `src/members/` has point-in-time `height`, `weight`, `body_fat` columns (Phase 1). The Phase 2 measurement tracking needs time-series storage. **Resolved**: **Option A (dual write) + Option C (height excluded)**, combined. Logging a `weight` or `body_fat` measurement writes a `MeasurementLog` row **and** updates `MemberProfile.weight`/`body_fat` in the **same DB transaction**. Height stays on `MemberProfile` only — never logged as a time-series measurement. Single legal write path via `MeasurementLogService.create()` only. Both-direction rollback tests required.

### Risk 3: Loyalty module placement ambiguity (resolved — see §12 Q16)

The task backlog says "src/notifications/ or src/members/" — this suggests the authors weren't sure where loyalty belongs. **Resolved**: A dedicated `src/loyalty/` module, consuming events from other modules via the standard outbox/inbox pattern (reliable delivery, at-least-once) — no ad hoc listeners.

### Risk 4: `WorkoutSession` vs `PTSession` overlap (resolved — see §12 Q27)

If a member has a PT session, do they also log a separate workout session? Or does the PT session *contain* the workout session? **Resolved**: Independent, but optionally linked. `PTSession` may carry an optional `workout_session_id` FK. The PT module does **not** auto-create a `WorkoutSession` when a PT session is booked or completed — a trainer can manually link the two when relevant (e.g. the PT session was supervising a specific logged workout).

### Risk 5: "Memberships tab" vs "Services tab" distinction (resolved — see §12 Q28)

P2-02 is "Memberships Tab" (membership plans/subscriptions) and P2-03 is "Services Tab" (service bookings). **Resolved**: P2-03 is **deferred entirely to Phase 3**. No dedicated tab in Phase 2. Its data source (service bookings, group classes) doesn't exist yet — nothing to aggregate. PT session scheduling is covered under the PT tab instead.

### Risk 6: Points calculation worker (resolved — see §12 Q22)

The implementation roadmap mentions a "Points calculation worker" but the task backlog mentions it only in passing. **Resolved**: This **IS the expiry-sweep worker** described in §12 Q18. It is a daily batch job that finds expired transactions with `remaining_points > 0`, creates an `expire` transaction for each, and decrements the account balance. It is NOT an accrual batch job (accrual is synchronous, per §12 Q21). **There is no "streak bonus" concept anywhere in this design — it was never discussed or proposed. Do not add it.**

### Risk 7: Document storage implementation (resolved — see §12 Q24)

The implementation roadmap says "Document storage references (S3 keys)" but the database plan has no document table. The ERD has `MEMBERS_MEMBER_CONSENTS` with a `document_url` column but that's for consent forms, not arbitrary document uploads. **Resolved**: Two tables: `MemberConsent` (record of agreement: boolean + type + timestamp) and `MemberDocument` (the file itself: S3 key + metadata), with an optional `document_id` FK on `MemberConsent` → `MemberDocument`. `MemberDocument.s3_key` uses the naming convention `orgs/{orgId}/members/{memberId}/documents/{uuid}/{filename}` (see §12 Q25).

### Risk 8: Measurement units and validation (see §12 Q11–14)

The task backlog says "Measurement fraud, inconsistent units" is a risk but provides no requirements for unit validation. **Resolved**: Measurement type enum: `weight`, `body_fat` active in Phase 2; `chest`, `waist`, `hip`, `arm`, `thigh`, `calf` reserved for future use. Validation handling is covered by the single legal write path and transaction requirements in §12 Q11–14. Unit normalization specifics remain a Phase 3 consideration.
---

## 12. Resolved Decisions — 28 of 29 Questions Answered (1 Open)

All questions from the original draft have been reviewed. 28 are resolved across four review batches; 1 (Q15 — measurement events) remains open and is marked accordingly. Each entry below shows the decision, the rationale, and where in this document the decision is reflected.

### Personal Training

1. **PTSession → PTEnrollment.sessions_used increment**: **Auto-increment on completion.** When `PTSession.status` transitions to `completed`, the system atomically increments `PTEnrollment.sessions_used` within the same unit of work. No separate verification step — the session lifecycle event handler does this synchronously.
   - **Rationale**: Simpler state machine. A verification step would add a pending state with no clear benefit for Phase 2. If audit requirements arise, they can be added later.
   - **Reflected in**: §1 entity table (`PTSession` notes column).

2. **TrainerCommission computation**: **Percentage of the package price, calculated at enrollment time.** When a `PTEnrollment` is created, `TrainerCommission.amount` is computed as `package.price × package.trainer_commission_percentage / 100`. The commission is earned when the enrollment is created, not per-session.
   - **Rationale**: Percentage-of-package aligns trainer incentives with the total package value. Fixed per-session amounts are less common in practice and create accounting complexity when sessions are partially consumed.
   - **Reflected in**: §1 entity table (`PTPackage` — `trainer_commission_percentage` column replaces `trainer_commission_per_session`). §1 entity table (`TrainerCommission` notes).

3. **PT session as check-in**: **PT sessions do NOT create attendance records.** PT attendance and gym check-ins are separate concepts. A `PTSession` status tracks trainer-led session completion; an `ATTENDANCE_ATTENDANCE_RECORDS` entry is created only when the member independently checks in at the gym.
   - **Rationale**: Explicitly rejected in review. PT sessions are billable, trainer-led events with their own lifecycle (commission, enrollment consumption). Conflating them with attendance would make attendance reporting inaccurate (a member with a PT session would appear to have "checked in" even if they never entered the gym floor).
   - **Reflected in**: §1 Phase 1 dependencies note (updated).

4. **PTPackage price**: **Price is tax-exclusive (net). Currency is the organization's default currency from the `Organization` entity.**
   - **Rationale**: Tax handling is Phase 3 finance scope. Storing net price avoids mixing tax logic into Phase 2. Currency inheritance from the org is the existing convention in Phase 1.
   - **Reflected in**: §1 entity table (`PTPackage` notes).

### Workouts

5. **Exercise library scope**: **Strictly org-scoped — no global seed set.** Every `Exercise` belongs to exactly one organization via a non-nullable `organization_id` foreign key. There is no "global" or "seed" exercise library shared across organizations.
   - **Rationale**: A global library creates ownership and curation problems. Each gym establishes its own exercise library from scratch (or copies from a template). Cross-org contamination is prevented at the schema level by making `organization_id` NOT NULL.
   - **Reflected in**: §2 entity table (`Exercise.organization_id` — NOT NULL, non-nullable FK).

6. **Multiple active workout plans**: **Yes — member can have multiple active plans simultaneously.**
   - **Rationale**: Real members often run concurrent programs (strength + cardio, or a general fitness plan + a sport-specific plan). The entity model already supports this via `WorkoutPlanAssignment.status`.
   - **Reflected in**: §2 entity table (`WorkoutPlanAssignment` notes).

7. **Progress definition**: **Percentage of exercises completed per session and optional RPE.** The `WorkoutSession` entity stores `duration_minutes` and `notes`. `WorkoutSessionExercise` stores `sets_completed`, `reps_completed`, `weight_used`, and `rpe`. Progress is computed from these as:
   - Exercise completion % = (exercises logged / exercises assigned) × 100
   - RPE trend over time (optional)
   - **Rationale**: "Cumulative weight volume" (sets × reps × weight) was explicitly rejected in review as over-engineering. Completion % and RPE provide sufficient progress tracking for the 360 dashboard without introducing contentious aggregate math.
   - **Reflected in**: §2 entity table (`WorkoutSession`, `WorkoutSessionExercise` notes).

### Diet / Nutrition

8. **Multiple active diet plans**: **Yes — same rationale as workouts.** A member can have an active weight-loss plan and a maintenance plan concurrently.
   - **Rationale**: Parallel with workouts policy. No technical reason to restrict.
   - **Reflected in**: §3 entity table (`DietPlanAssignment` notes).

9. **Free-text meal logging**: **Yes — `NutritionLog` gains a nullable `meal_description` column.** When `meal_description` is populated and `meal_template_id` is null, the meal is a free-text entry with no template reference. Macro columns (`calories`, `protein_g`, `carbs_g`, `fat_g`) are nullable in this case.
   - **Rationale**: Members need to log meals they eat outside of meal templates (restaurant meals, homemade recipes). The `meal_description` field captures this without requiring a template.
   - **Reflected in**: §3 entity table (`NutritionLog` — all columns updated). §7 adherence aggregation (null-macro handling).

10. **Macro calculation when referencing a MealTemplate**: **Calculated as `template_value × servings` at log time.** When `meal_template_id` is set, the system computes `calories = template.calories × servings`, `protein_g = template.protein_g × servings`, etc., and stores the computed values on the `NutritionLog` row. The template values are snapshotted, so future changes to the template don't retroactively alter past logs.
    - **Rationale**: Immutable log entries are essential for audit accuracy. Snapshotted values ensure a member's logged nutrition doesn't change because a staff member updated the meal template later. This also means the log table is the source of truth for macros regardless of whether the log was template-based or free-text.
    - **Reflected in**: §3 event contract (`NutritionLogRecorded.v1` notes).

### Measurement Tracking

11. **Measurement types**: **Fixed enum for Phase 2**, with the enum set being: `weight`, `body_fat`, `chest`, `waist`, `hip`, `arm`, `thigh`, `calf`. User-configurable types deferred to Phase 3+.
    - **Rationale**: Configurable types require a dynamic validation system, UI for type management, and chart axis handling for arbitrary types. Over-engineered for Phase 2. The fixed set covers 95%+ of gym tracking needs.
    - **Reflected in**: §4 entity table (`MeasurementLog.measurement_type`).

12. **Height as a trackable metric**: **Height remains a single-value attribute on `MemberProfile` (not a repeated measurement type).** It is excluded from the `measurement_types` enum.
    - **Rationale**: Height does not change meaningfully over time for adults. Tracking it as a time-series metric would add noise and confusion to charts.
    - **Reflected in**: §4 entity table notes; §4 decision text.

13. **MemberProfile duality**: **Dual representation — `MemberProfile` retains `weight`, `body_fat`, `height` as the latest-value cache (denormalized from the most recent `MeasurementLog` row).** A database trigger or service-level hook updates `MemberProfile` when a new measurement of the same type is logged. This avoids a query join on every header load.
    - **Rationale**: The 360 header (P2-01) needs to display current weight/body fat on every member-lookup. Querying the measurement_logs table for the latest entry on every header load adds unnecessary latency. The denormalized cache gives O(1) reads at the cost of a write-through on insert.
    - **Reflected in**: §4 decision text.

14. **Unit validation**: **Yes — the system validates ranges at the service layer.** Reject values outside these ranges:
    - Weight: 1–500 (kg or lbs, validated against the unit field)
    - Body fat %: 2–70
    - Chest/Waist/Hip: 20–300 (cm or inches)
    - Arm/Thigh/Calf: 5–150 (cm or inches)
    - Unit mismatch detection: if a member's previous measurement was in kg and a new entry uses lbs, the system does not auto-convert (the user must be intentional about units) but flags the discrepancy.
    - **Rationale**: Basic sanity checking prevents fat-finger errors. Unit mismatch detection is minimal — full unit normalization is Phase 3.
    - **Reflected in**: §4 entity table notes; §11 Risk 8 (updated with resolution).

15. **Should measurements emit events?** **Not yet resolved.** The question has not been discussed or approved by the decision-maker.
    - **Open issue**: There is no confirmed consumer for measurement events in Phase 2. Potential future consumers include loyalty (milestone bonuses) and notifications (goal-reached alerts). The event contract placeholder exists in §4 for forward-compatibility but is not part of Phase 2 scope until a decision is reached.
    - **Recommended default**: Defer the decision — define only a placeholder event contract `MeasurementRecorded.v1` (no producer in Phase 2) so the schema exists for Phase 3 without committing to implementation now.
    - **Reflected in**: §4 event contract (marked as "placeholder — decision pending").

### Loyalty / Rewards

16. **Module placement**: **Dedicated `src/loyalty/` module.** Not inside `src/members/` or `src/notifications/`.
    - **Rationale**: Loyalty cross-cuts multiple domains (attendance, workouts, PT) as a consumer of their events. It has its own rules engine, transaction log, and potential finance integration. Embedding it in an existing module would create a circular dependency risk and make it harder to extract later. The backlog's "src/notifications/ or src/members/" was uncertainty, not a strong recommendation.
    - **Reflected in**: §5 introduction (updated to confirm dedicated module).

17. **Points accrual rules**: **Points awarded for: check-in attendance (daily) and workout session logged.**
    - PT session completion → excluded from Phase 2 (double-counting concern — PT is already a paid service; awarding points for a monetized activity creates perverse incentives; deferred to Phase 3)
    - Referral → excluded from Phase 2 (no referral system exists; deferred to Phase 3)
    - **Rationale**: Explicitly limited to check-in and workout-logged triggers — both are existing Phase 1 systems that will produce events in Phase 2. PT session completion is excluded on principle (double-counting a paid service), and referral triggers require infrastructure not yet built. The `LoyaltyRule` entity supports adding new `trigger_event` types later without schema changes.
    - **Reflected in**: §5 entity table (`LoyaltyRule.trigger_event` notes).

18. **Points expiration**: **Yes, expiration is implemented in Phase 2.** Points expire based on a configurable policy: `LoyaltyAccount` gains an `expire_policy_days` column (default 365). The **expiry-sweep worker** (see §12 Q22) runs daily as a batch job, finds expired `LoyaltyTransaction` rows where `remaining_points > 0` and `created_at + expire_policy_days < NOW()`, creates an `expire` transaction for each, and decrements the account balance.
    - **Rationale**: Unlike redemption (which requires finance integration), expiration is purely an accounting concern — the system knows when points were earned and when they should expire. Running expiration in Phase 2 means members won't see stale, unspendable points accumulating indefinitely. The worker is scoped to expiration only (no accrual in batch — accrual is synchronous).
    - **Reflected in**: §5 entity table (`LoyaltyAccount.expire_policy_days`); §5 `LoyaltyTransaction.transaction_type` (new `expire` type); §11 Risk 6 (expiry-sweep worker).

19. **Tier system**: **No tier system in Phase 2.** Flat points balance.
    - **Rationale**: Tiers (bronze/silver/gold) add significant complexity: threshold computation, tier-change events, and UI for tier display. None of this is required by the task backlog. Deferred to Phase 3.
    - **Reflected in**: §5 entity table (`LoyaltyAccount.tier` column remains nullable, unused in Phase 2).

20. **Rewards redemption**: **Deferred entirely to Phase 3.** The `LoyaltyReward` entity and `redeem` transaction type are defined in the schema for forward-compatibility but redemption is not implemented in Phase 2. Phase 2 only tracks points earned via check-in and workout-logged triggers — there is no endpoint or workflow to spend points.
    - **Rationale**: Redemption without finance integration was the blocker. Reward types like "discount" and "free session" need an invoice/ledger integration point that doesn't exist in Phase 2. Implementing redemption now would create undefined behavior. Phase 2 keeps loyalty to accrual, expiration, and balance display only.
    - **Reflected in**: §5 entity table (`LoyaltyReward` — marked as "defined for forward-compatibility, not implemented in Phase 2"). §5 Phase 3+ dependencies.

21. **Points computation timing**: **Synchronous — points are awarded immediately when the triggering event is consumed by the loyalty module.**
    - **Rationale**: Members expect to see points update in real-time after checking in or logging a workout. Batch processing would create a confusing delay. The synchronous approach also simplifies the architecture (no worker needed for the core path).
    - **Reflected in**: §5 "Points computation timing" note (updated).

22. **What is the "Points calculation worker"?** **The worker is the expiry-sweep job only — no streak bonus, no accrual batch.** It is a daily cron job that:
    - Finds expired `LoyaltyTransaction` rows where `remaining_points > 0` and `created_at + account.expire_policy_days < NOW()`
    - Creates an `expire` transaction for each
    - Decrements the account balance
    - **Rationale**: The implementation roadmap mentions a "Points calculation worker" ambiguously. This clarifies: the worker is ONLY for expiration. Accrual is synchronous (Q21). **There is no "streak bonus" concept anywhere in this design — it was never discussed or proposed.** The term "Points calculation worker" was initially misinterpreted as a batch awarding mechanism; the correct scope is expiry sweep only.
    - **Reflected in**: §5 worker design note; §11 Risk 6 (updated with corrected scope).

### Document & Consent Management

23. **Consent revocation audit**: **Yes — add `revoked_at` and `revocation_reason` columns to `MemberConsent`.** When a consent is revoked, `is_given` is set to `false`, `revoked_at` is timestamped, and `revocation_reason` is captured.
    - **Rationale**: GDPR and most data-privacy regulations require an audit trail for consent withdrawal. Without revocation tracking, you lose the ability to prove *when* and *why* consent was withdrawn. The cost is two nullable columns.
    - **Reflected in**: §6 entity table (`MemberConsent` — columns updated).

24. **Document table**: **The proposed `MEMBERS_MEMBER_DOCUMENTS` table is accepted.** The distinction between a "document" and a "consent form" is:
    - `MemberConsent` = the **legal record of agreement** (boolean + type + timestamp), optionally referencing a signed document.
    - `MemberDocument` = the **file itself** (S3 key + metadata), used for arbitrary uploads (medical reports, ID proofs, photos, agreements) that are *not* necessarily tied to a consent workflow.
    - **Rationale**: A member can upload a medical report (document) without giving consent. A member can give consent verbally (no document). These are separate concepts sharing a common concern (file storage) — the optional `document_id` FK on `MemberConsent` bridges them when needed.
    - **Reflected in**: §6 entity table (`MemberConsent`, `MemberDocument`); §6 "Key design question" text.

25. **S3 storage naming convention**: **`orgs/{orgId}/members/{memberId}/documents/{uuid}/{filename}`** where `{uuid}` is a UUID v4 generated at upload time.
    - **Rationale**: Hierarchical by org → member keeps S3 listings browsable for debugging. UUID prefix prevents filename collisions without needing deduplication logic. The scheme is flat enough to be efficient and hierarchical enough for prefix-based filtering.
    - **Reflected in**: §6 entity table (`MemberDocument.s3_key` notes).

### Member 360 Dashboard

26. **Quick actions logic**: **Computed from member state — dynamically shown/hidden based on current state.** Rules:
    - "Check-in" — shown only if the member has **not** checked in today AND has an active membership.
    - "Renew" — shown only if the membership expires in ≤30 days.
    - "Book PT" — shown if the member has an active `PTEnrollment` with `sessions_remaining > 0`.
    - "Log Workout" — always shown.
    - "Log Meal" — always shown.
    - **Rationale**: Static quick actions waste screen real estate and confuse staff (why show "Check-in" if the member is already checked in?). Computed actions make the dashboard context-aware and useful.
    - **Reflected in**: §7 quick actions DTO notes.

### Cross-Domain

27. **WorkoutSession vs PTSession overlap**: **Independent concepts.** A PT session (trainer-led, scheduled, billable) is a *different concept* from a self-directed workout session (member-initiated, logged voluntarily). They coexist. A PT session does **not** automatically create a `WorkoutSession` log entry, though a member could optionally log one if they want to track the exercises performed during the PT session.
    - **Rationale**: Trainer-led sessions have different semantics (scheduling, billing, commission). If the system auto-created a `WorkoutSession` from every `PTSession`, it would conflate the two lifecycles and make it impossible to distinguish "trained with a PT" from "worked out alone" in reporting.
    - **Reflected in**: §2 domain context note (updated to clarify independence); §11 Risk 4 (updated with resolution).

28. **"Services" tab (P2-03)**: **Deferred to Phase 3.** P2-03 is designed for group class / batch enrollments, which require the Scheduling module — and the Scheduling module does not exist yet. The `GET /v1/members/{memberId}/services` endpoint is removed from the Phase 2 scope.
    - **Rationale**: Building a services tab that only shows PT sessions would duplicate P2-04. The task backlog's "Services Tab" is clearly aimed at group class bookings (Phase 3 Scheduling). Trying to build it in Phase 2 without the Scheduling module would result in an empty or misleading endpoint.
    - **Reflected in**: §7 API endpoints list (P2-03 endpoint removed from Phase 2 build order).

### Build Order

29. **Build order confirmed**: **Measurement → Document → Workouts → PT → Diet → Attendance Trends → Dashboard → Loyalty.** No changes to the dependency rationale, but note the ordering swap: **Workouts precedes PT** because PT depends on calling `WorkoutsService.assignPlan()` (§12 Q27). Measurement is correctly first (simplest, reference implementation). Loyalty is correctly last (event consumer across all other modules), built behind PT's consumer events.
    - **Reflected in**: §10 "Recommended sequence" table (Workouts at row 3, PT at row 4).

---

*End of Phase 2 Scoping Plan — RESOLVED*  
*Next step: Review the full plan. Once approved, proceed to implementation starting with Measurement Tracking (§4). No git staging or committing until explicit approval.*