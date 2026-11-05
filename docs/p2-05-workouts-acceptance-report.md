# P2-05 Workouts — Implementation and Acceptance Record

**Date:** 2026-11-01
**Branch:** `feat/p2-05-workouts-lifecycle` (worktree `/home/cyberbeast/Projects/gym-saas-p2-05-workouts-final`)
**Base / HEAD:** `afc6bf7b0eddef5c6543126ba9ba38d212d1fe85` — identical to `origin/main` at the start of this task. All changes are uncommitted in the worktree; nothing was committed, pushed, opened as a PR, or merged.
**Task tier:** Tier 2 (authorization, tenancy, data mutations, API contracts).

**Overall status: IMPLEMENTED ON BRANCH AND TIER-2 VERIFIED FOR THE SUPPORTABLE SCOPE — NOT DECLARED COMPLETE.**
Three owner-approved requirements are **BLOCKED** by capabilities the repository does not contain: a member-account identity link, a trainer/member role model, and a biometric attendance source. They are reported below with the evidence needed to resolve them; no substitute was invented.

---

## 1. What was implemented

The Workouts module now distinguishes and persists every approved concept:

| Concept | Storage |
|---|---|
| Exercise library (+ optional image/GIF/YouTube) | `WORKOUTS_EXERCISES` (media columns) |
| Reusable workout-day template | `WORKOUTS_WORKOUT_DAY_TEMPLATES` + `_EXERCISES` |
| Reusable weekly plan template | `WORKOUTS_WORKOUT_PLAN_TEMPLATES` + `_DAYS` |
| Member plan assignment | `WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS` (legacy `template_id` or `plan_template_id`) |
| Assignment-specific prescribed day | `WORKOUTS_PRESCRIBED_DAYS` + `_EXERCISES` (snapshot) |
| Member workout session | `WORKOUTS_WORKOUT_SESSIONS` + `_SESSION_EXERCISES` |
| Member day submission (immutable) | `WORKOUTS_PLAN_DAY_SUBMISSIONS` + `_EXERCISES` |
| Trainer day review (append-only) | `WORKOUTS_PLAN_DAY_REVIEWS` |
| 30–45-day progress review | `WORKOUTS_PROGRESS_REVIEWS` + `_MEASUREMENTS` (snapshots of existing measurement rows) |

### 1.1 Assignment snapshots

`assignPlanTemplate()` and the legacy `assignPlan()` both copy the plan's days and prescriptions into assignment-specific prescribed rows in the same transaction. The reusable template is never read again for that assignment; the real-Postgres test edits the source template and re-reads the assigned snapshot to prove it is unchanged. Reusing a template for a second member creates independent prescribed rows.

### 1.2 Rolling sequence and carry-forward

`sequence_order` is the stable order; no calendar date or expiry window is consulted. `GET /v1/workouts/members/:memberId/sequence` returns the ordered days and `current_day_id` = the first non-rest day whose status is not `approved`. A missed day remains current until the trainer approves it; later days shift behind it. Rest markers are snapshotted for display but excluded from the denominator and the current-workout selection. A member may rest or use a rest day to catch up — both leave the pending day in place.

### 1.3 Session lifecycle

`in_progress` → `finished` (locked, `completed_at`) or `cancelled` (`cancelled_at`, retained in history). A finished session cannot be cancelled or edited. Multiple sessions may point at the same `prescribed_day_id`; they never create a second plan day. Standalone sessions have no assignment/prescribed day. Trainers soft-delete sessions (`deleted_at`/`deleted_by`, no reason); soft-deleted rows are excluded from ordinary history but retained. Deletion does not touch plan-day status or submission snapshots.

### 1.4 Plan-day review workflow

Day statuses: `pending` → `submitted` → (`remaining_required` → `submitted` …) → `approved`. A member submission is immutable and is derived server-side from the member's finished sessions for that day (the client cannot submit arbitrary completion values). The trainer may approve a fully complete, partially complete, or entirely missed day; approval requires no submission and no percentage threshold. Only a trainer decision sets `approved`; a finished session or a member submission never does. Re-reviewing an approved day answers 409, preserving history.

### 1.5 Primary progress formula (owner decision)

`trainer-approved finished prescribed days / total prescribed (non-rest) days × 100`, capped at 100. Submitted, pending and remaining-required days are excluded; rest days are excluded from the denominator; sessions, repeated exercise rows and standalone sessions are not counted. `exercise_completion` is returned as a separate supporting metric only. This retires the shipped exercise-row denominator.

### 1.6 30–45-day reviews and measurements

A review stores the review date, period, approved/prescribed counts and percentage, a plan-day status summary, a **read-only snapshot of the member's real attendance records for the period**, the trainer's results/improvements/goal/observations/recommendations, the plan decision, the reviewer, and the measurement snapshot. `measurement_ids` reference existing `MEMBERS_MEMBER_MEASUREMENTS` rows; the review copies type/value/unit/date so later measurement writes do not rewrite history. `GET /v1/workouts/members/:memberId/progress-reviews/comparison` returns the historical series. If `next_assignment` is supplied, it is created and linked in the same transaction; otherwise the active plan is untouched. Nothing expires or advances automatically.

---

## 2. Migrations

| Migration | Purpose |
|---|---|
| `1793000000000-AddExerciseMedia` | Adds `image_key`, `image_mime_type`, `gif_key`, `gif_mime_type`, `video_url` to exercises. |
| `1793000000001-CreateWorkoutDayAndPlanTemplates` | Creates reusable day/plan template tables, exercise rows, ordered day slots, FKs and unique constraints. |
| `1793000000002-CreatePrescribedWorkoutDays` | Adds assignment source/snapshot columns; makes legacy `template_id` nullable with a CHECK; creates prescribed-day/exercise snapshot tables; **backfills existing legacy assignments** grouped by `COALESCE(day_of_week, 0)`; backfills exercise snapshots and `snapshot_taken_at`. No approval is invented. |
| `1793000000003-ExtendWorkoutSessionsForP205` | Adds session status, prescribed-day link, `created_by`, cancellation/soft-delete columns, updated_at, and the session-exercise report columns. Existing pre-lifecycle sessions are backfilled to `finished` (view-only); no row is deleted or re-dated. |
| `1793000000004-CreateWorkoutReviews` | Creates submissions/submission exercises, day reviews, progress reviews and measurement snapshots; adds the assignment→review FK. |

A fresh migrated database contained **61** `typeorm_migrations` records, including all five new ones (`MIGRATION_TOTAL=61`, `NEW_MIGRATIONS=5`). No permission migration was added: the new routes use the existing `workout:*` permissions provisioned by `1788965263244-ProvisionWorkoutPermissions`.

---

## 3. API surface

All routes are under `v1/workouts` (plus the existing combined tab). Every handler carries `@RequirePermissions`; every service query carries `organization_id`.

| Route | Permission |
|---|---|
| `GET/POST /v1/workouts/exercises` | `exercise-read` / `exercise-manage` |
| `GET/PATCH /v1/workouts/exercises/:id` | `exercise-read` / `exercise-manage` |
| `POST /v1/workouts/exercises/:id/media` | `exercise-manage` |
| `DELETE /v1/workouts/exercises/:id/media/:mediaType` | `exercise-manage` |
| `PUT/DELETE /v1/workouts/exercises/:id/video` | `exercise-manage` |
| `GET/POST /v1/workouts/day-templates` | `template-read` / `template-manage` |
| `GET/PATCH /v1/workouts/day-templates/:id` | `template-read` / `template-manage` |
| `PUT /v1/workouts/day-templates/:id/exercises` | `template-manage` |
| `POST /v1/workouts/day-templates/:id/copy` | `template-manage` |
| `GET/POST /v1/workouts/plan-templates` | `template-read` / `template-manage` |
| `GET/PATCH /v1/workouts/plan-templates/:id` | `template-read` / `template-manage` |
| `PUT /v1/workouts/plan-templates/:id/days` | `template-manage` |
| `GET/POST /v1/workouts/members/:memberId/assignments` | `assignment-read` / `assignment-manage` |
| `GET /v1/workouts/assignments/:id` | `assignment-read` |
| `GET /v1/workouts/members/:memberId/sequence` | `assignment-read` |
| `GET /v1/workouts/prescribed-days/:id` | `assignment-read` |
| `POST /v1/workouts/prescribed-days/:id/submit` | `session-manage` |
| `POST /v1/workouts/prescribed-days/:id/review` | `assignment-manage` |
| `GET /v1/workouts/prescribed-days/:id/submissions` | `session-read` |
| `GET /v1/workouts/prescribed-days/:id/reviews` | `assignment-read` |
| `GET/POST /v1/workouts/members/:memberId/sessions` | `session-read` / `session-manage` |
| `GET/PATCH /v1/workouts/sessions/:id` | `session-read` / `session-manage` |
| `POST /v1/workouts/sessions/:id/finish` / `cancel` | `session-manage` |
| `DELETE /v1/workouts/sessions/:id` | `session-manage` (soft delete) |
| `GET/POST /v1/workouts/members/:memberId/progress-reviews` | `assignment-read` / `assignment-manage` |
| `GET /v1/workouts/members/:memberId/progress-reviews/comparison` | `assignment-read` |
| `GET /v1/workouts/progress-reviews/:id` | `assignment-read` |
| `GET /v1/members/:memberId/workouts` (existing tab) | three `*-read` permissions, unchanged |

The member id is always taken from the URL, never a body field. The legacy `CreateExerciseDto.organization_id` tenant hole was removed: exercise/template creation derives the org from the authorized context.

---

## 4. Event contracts

`packages/contracts/src/events/workouts.events.ts`, `docs/event-contracts.md` and `src/workouts/workouts.constants.ts` are in lockstep:

- `WorkoutPlanAssigned` (version `v1`) — emitted by both assignment paths. The event-type naming was corrected from the shipped `WorkoutPlanAssigned.v1` + version `1` to the repo convention (unversioned name + `v1`). No consumer exists.
- `WorkoutSessionLogged` — now has a producer (session creation), in the same transaction.
- `WorkoutPlanDaySubmitted` — member submission.
- `WorkoutPlanDayReviewed` — trainer decision.
- `WorkoutProgressReviewRecorded` — 30–45-day review.

All events are written through `OutboxService.saveEventEnvelope(..., manager)` inside the domain transaction. The real-DB test proves a rejected duplicate assignment emits no event and a committed assignment emits exactly one.

---

## 5. Frontend

- **Member 360 Workouts tab** (`apps/web/src/components/members/WorkoutsTab.tsx`): day-based approved-days progress (exercise completion shown separately), rolling sequence with the current day, trainer approve / request-remaining actions, session history with status and soft delete, progress reviews + measurement comparison + a review form (including optional next-plan linking), read-only attendance, and the exercise library.
- **Trainer page** (`apps/web/src/app/workouts/page.tsx`, sidebar entry): exercise creation + image upload + activate/deactivate, day-template creation and composition editor, weekly plan-template day ordering (repeat/optional/rest), and member plan assignment with simple/detailed logging mode.
- **Client layer**: new endpoints/types/hooks in `lib/workouts-api.ts`, `lib/measurements-api.ts`, `lib/attendance-api.ts`, `lib/hooks.ts`, `lib/types.ts`; `lib/api.ts` gained `postForm` for multipart uploads (it detects `FormData` and does not force a JSON Content-Type). Components still consume hooks only.
- **Member self-service UI is BLOCKED** by B1 below: there is no member login or member↔user link, so a member-facing portal cannot be authenticated as a member. The member-facing backend routes exist and are tested.

---

## 6. Verification evidence (all MEASURED in this worktree)

### 6.1 Gates

| Check | Result |
|---|---|
| `npm run typecheck` | `EXIT=0` |
| `npm run lint` | `EXIT=0` |
| `npx jest --passWithNoTests` (full hermetic backend suite) | `Test Suites: 154 passed, 14 skipped, 154 of 168`; `Tests: 1695 passed, 162 skipped, 1857 total`; `EXIT=0`; `Time: 309.014 s` |
| `src/app.boot.spec.ts` (real AppModule DI) | `5 passed, 5 total`; `EXIT=0` |
| `RUN_DB_INTEGRATION=1 npx jest src/workouts --runInBand` (scratch DB) | `Test Suites: 9 passed, 9 total`; `Tests: 74 passed, 74 total`; `EXIT=0`; `EXPORTED_JWT_SECRET_COUNT=0` |
| `RUN_DB_INTEGRATION=1 npx jest src/pt --runInBand` | `9 passed, 9 total`; `92 passed, 92 total`; `EXIT=0` |
| `npx jest src/migrations/__specs__ --runInBand` | `22 passed, 22 total`; `93 passed, 93 total`; `EXIT=0` |
| `apps/web: npm run typecheck` | `EXIT=0` |
| `apps/web: npm run lint` | `0 errors, 21 pre-existing warnings`; `EXIT=0` (none in the P2-05 files) |
| `apps/web: npm run test -- --runInBand` | `6 passed, 6 total`; `37 passed, 37 total`; `EXIT=0` |
| `apps/web: npm run build` | `EXIT=0`; `/workouts` route built (`4.79 kB`) |
| `npm run api:gate -- --env-path=<primary>/.env` (with `DEV_DB_PUBLISHED_PORT=5433`) | `TOTAL pass 126 fail 0 skip 0`; `RESULT: PASS (0 failed)`; `API_GATE_EXIT=0`; workouts group `25 pass, 0 fail, 0 skip` |

The first gate attempt failed one check (`wo-23`: measurement creation answered 404 `Member profile not found` because `POST /v1/members` does not create a `MEMBERS_MEMBER_PROFILES` row). The gate fixture now inserts the profile first. This is a **pre-existing P2-07 dependency**, not a P2-05 route defect; see decision D5.

### 6.2 Real-database integration suite (18/18)

`src/workouts/services/workouts-p205.integration.spec.ts` — `EXIT=0`:

- exercise library + day/plan template composition;
- assignment snapshot preserved after editing the reusable template;
- template reused for a second member without changing the first plan;
- progress 0 with rest excluded; session finish does not approve a day; multiple sessions on one day keep one day identity and retain both submissions;
- trainer approval of a partial day and a missed day; 100% only from approved days; approved day cannot be re-reviewed;
- standalone/cancelled sessions do not complete a plan day; soft delete keeps submissions/progress intact;
- progress review snapshots real attendance + existing measurement; later measurement does not rewrite it; next assignment linked in the same transaction; comparison series;
- cross-organization read/write denial in both directions; a session cannot attach to another member's day;
- no outbox event for a rejected mutation, exactly one for a committed mutation;
- in-progress session editable, finished session locked; inverted period and foreign measurement rejected.

The suite was run against a database created by this task (`gym_p205_lifecycle_20261101`), migrated from zero to 61 records. Redis db 15 was `0` before and after; the dev index (db 0) stayed at `6`. The scratch database was dropped after the runs.

### 6.3 Mutation proofs

Each mutant was saved by copy, restored by copy, and the sha256 before/after is identical. Each typechecked (`EXIT=0`) and failed by assertion, not timeout.

| # | File | Mutation | sha256 before = after | Typecheck | Killed by |
|---|---|---|---|---|---|
| M1 | `src/workouts/services/workout-assignments.service.ts` | count `submitted` days as approved | `c6b6f0e9…9c41` | `EXIT=0` | `workout-assignments.service.spec.ts` “counts ONLY trainer-approved days…” — `Expected 1 / Received 2` (assertion) |
| M2 | same | snapshot `sets: 0` instead of the prescribed sets | `c6b6f0e9…9c41` | `EXIT=0` | “snapshots every plan day…” — `Expected sets: 3 / Received sets: 0` |
| M3 | `src/workouts/services/workout-sessions.service.ts` | allow cancelling a finished session | `b5a3bae2…69d0` | `EXIT=0` | “locks a finished session…” — promise resolved instead of rejected |
| M4 | same | drop `member_id` from the prescribed-day assignment lookup | `b5a3bae2…69d0` | `EXIT=0` | real-DB “does not let a member attach a session to another member's prescribed day” — resolved instead of rejected |
| M5 | `src/workouts/services/workout-assignments.service.ts` | drop the `is_rest_day = false` denominator filter | `c6b6f0e9…9c41` | `EXIT=0` | “counts ONLY trainer-approved days…” — expected the rest-day predicate, received the assignment predicate |

A first M4 attempt did not match the code (indentation) and was therefore a no-op; it is **not** reported as a survivor. The corrected mutant above was killed.

### 6.4 Not run / not verified

- **CI** (`ci (24)`, `web`, `integration`): UNVERIFIED — no commit/push/PR was authorized.
- **`docker-image`**: not run (main pushes only).
- **Playwright/browser E2E**: not run; member self-service has no authenticated UI (B1), and no push was made.
- **External biometric integration**: no vendor/API/schema exists; nothing was simulated.

---

## 7. Acceptance matrix

Legend: PASS = implemented and evidence-backed; PARTIAL = implemented with a stated gap; BLOCKED = cannot be satisfied by this repository; NOT IMPLEMENTED = deliberately absent (not approved or out of scope).

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Distinct exercise / day template / weekly template / assignment / prescribed day / session / review entities | PASS | §1 table; integration tests assert independent identities |
| 2 | General trainer vs professional PT assignment responsibilities | **BLOCKED** | No general-trainer identity or member/trainer roles; only `owner` is provisioned (`1788965263244`). `PT_TRAINERS.user_id` is optional. Org/member boundary validation is implemented. See B2. |
| 3 | Exercise library: browse/search/create/edit/media; validated types/size/URL; storage authorization | PASS | CRUD routes; S3 key builder; MIME/size validation; strict YouTube allow-list; unit tests + gate `wo-03…wo-05` |
| 4 | Reusable day templates: compose, copy, modify copy independently, reuse | PASS | copy test asserts new rows and all prescription fields; integration reuse test |
| 5 | Weekly templates: compose any split/repeat/optional/rest; reuse for members | PASS | plan-template days unique order; rest/optional markers; integration sequence test |
| 6 | Editing a template never changes existing assignments | PASS | real-DB snapshot test; `snapshot_taken_at`; `WORKOUTS_PRESCRIBED_*` |
| 7 | Rolling sequence, missed workouts carry forward, later workouts shift, rest-day flexibility, no expiry | PASS | `current_day_id` = first non-approved non-rest; no date/expiry predicate anywhere; integration current-day test |
| 8 | Member sessions: standalone allowed, multiple per day, one day identity, no auto-completion | PASS | session tests; integration 2-session test; progress remains day-based |
| 9 | **Only members may create/log sessions; cannot create for another member** | **BLOCKED** | No `IDENTITY_USERS` ↔ `MEMBERS_MEMBERS` link (B1). The API enforces org membership + `session-manage` + URL member id, not member identity. |
| 10 | Regular members: checkbox logging; PT members: actual sets/reps/weight | PASS | `logging_mode` simple/detailed; service requires `completed` for simple and sets/reps for detailed; PT legacy path defaults detailed. Mode is trainer-chosen (D3) because Workouts must not read PT. |
| 11 | Session finish locks; cancel own in-progress; finished cannot cancel; cancelled retained | PASS | unit + integration lifecycle tests |
| 12 | Trainer soft-deletes sessions; no reason; audit metadata; excluded from history | PASS | `deleted_at/by`; integration soft-delete test; no restore route |
| 13 | Session deletion does not alter approved plan-day history or progress | PASS | integration compares submissions/progress before/after delete |
| 14 | Trainer review: approve full/partial/missed; request remaining; next-day close; decision authoritative | PASS | `reviewDay` tests incl. approval with no submission; integration |
| 15 | Immutable submissions/reviews; day identity across sessions; statuses | PASS | append-only rows; integration two-submission test; review history |
| 16 | Progress formula approved/prescribed, rest excluded, cap 100, no session/exercise inflation | PASS | unit + integration + mutations M1/M5; supporting exercise metric separate |
| 17 | 30–45-day review checkpoint, no expiry/auto-advance; decision recorded | PASS | review records; no scheduler or status mutation; `next_assignment` only when explicit |
| 18 | Progress review fields, reviewer, link to new assignment, historical immutability | PASS | entity + integration; review snapshot test |
| 19 | Reuse existing Measurements; link records; comparison; no duplicate source | PASS | measurement ids validated per member/org; snapshots; comparison endpoint; later measurement does not rewrite review |
| 20 | Biometric attendance source; trainers read-only; cannot fabricate; separate from workouts | **BLOCKED** | No biometric vendor/API/schema/sync exists (B3). Real `ATTENDANCE_ATTENDANCE_RECORDS` are read-only snapshotted; no write route is used; nothing is fabricated. |
| 21 | Auth/tenancy: cross-org rejection, URL identity authoritative, every query scoped, relationships validated, no event on failed mutation | PARTIAL | Org scoping and 404s verified (gate `wo-20…wo-22`, integration); no body member id; relationship validation implemented. Member-only identity and trainer/member role separation BLOCKED (B1/B2). |
| 22 | Database/API/event design; migration accounts for legacy records | PASS | §2–§4; backfill leaves legacy approvals at 0 and legacy sessions unlinked, documented |
| 23 | Frontend: trainer exercise library/templates/assignment/review/attendance; member experience | PARTIAL | Trainer tab + `/workouts` page implemented; member self-service BLOCKED (B1); no post-finish correction/restore UI (not approved) |
| 24 | Out-of-scope list (no trainer-created sessions, auto-approval, expiry, auto-progression, row-count progress, auto-completion, restore, biometric edits, template cascade) | PASS | None added; tests pin the negative behaviors |
| 25 | Testing: library/templates/scheduling/session/review/progress/measurement/attendance/tenancy | PARTIAL | 74 workouts tests (18 real-DB), 5 mutation proofs, gate 25/25. Member-identity and biometric cases cannot be tested against a missing capability. |
| 26 | Documentation and acceptance record | PASS | This record; `docs/task-backlog.md`; `docs/event-contracts.md`; `docs/phase2-scoping-plan.md` correction |

---

## 8. Blockers and required owner decisions

### B1 — No authoritative member-account identity (material blocker)

`IDENTITY_USERS` has no `member_id`; `MEMBERS_MEMBERS` has no `user_id`; there is no link table. Therefore “only members may create/log workout sessions” and “members cannot create sessions for other members” cannot be enforced or proved; the current API enforces organization membership, `workout:session-manage`, and the URL member id. A trainer/owner token can still create a session for a member in the same org.

Options (owner decision required; none was chosen):
1. Add `user_id` to `MEMBERS_MEMBERS` (new identity key scheme; migration + backfill policy).
2. Add an identity↔member link table (supports one login across memberships/orgs).
3. Match a verified, unique email per organization (requires a uniqueness policy and verified-email enforcement; the current `members` email index is not unique).

Until one is ruled, member-facing UI and member-only authorization remain BLOCKED.

### B2 — No trainer/member role model (material blocker)

Only the `owner` role is provisioned; the security plan names Admin/Manager/Trainer/FrontDesk/Member as intent, not code. There is no general-trainer identity; `PT_TRAINERS.user_id` is nullable and PT-only. The regular-member-trainer vs professional-PT assignment rule and a distinct “trainer may delete/approve” authorization are therefore not enforceable at the role layer. Route permissions and org scoping are implemented; the role split needs an owner-ratified role/permission matrix and trainer↔user linkage.

### B3 — Biometric attendance source absent (material blocker)

No vendor, API, database schema or synchronisation exists. `ATTENDANCE_ATTENDANCE_RECORDS` is the real source; `check_in_method` defaults to `manual` and the attendance service supports future device/biometric methods. The progress review snapshots the real records read-only. No biometric record is simulated or fabricated. Resolve by naming the biometric vendor/integration contract and sync mechanism.

### D1–D7 — Smaller owner decisions

- **D1 Media limits:** 5 MiB and JPEG/PNG/WebP for images, GIF for animation. These are implementation defaults in `src/workouts/workouts.constants.ts`, not owner-ratified values.
- **D2 Optional days:** `is_optional` is modelled, included in the prescribed denominator, and still requires trainer approval. Confirm whether an optional day should be excluded from the denominator or auto-closed.
- **D3 Logging mode:** the trainer selects `simple`/`detailed` on assignment; the PT legacy path defaults to `detailed`. Workouts cannot infer this from `PT_PT_ENROLLMENTS` without reversing the one-directional `PT → Workouts` dependency. Confirm the selection policy.
- **D4 Event naming:** `WorkoutPlanAssigned` now uses the unversioned name + version `v1` (the shipped code used `WorkoutPlanAssigned.v1` + `1`). No consumer exists; confirm no external consumer depends on the old string.
- **D5 Member profile provisioning:** `POST /v1/members` does not create `MEMBERS_MEMBER_PROFILES`, so measurement creation (and therefore linking measurements to a review) 404s for a newly created member. The gate inserts a profile before the measurement. Decide whether member creation should provision a profile; this is pre-existing P2-07 behavior.
- **D6 Post-finish correction:** no correction workflow exists for a finished session (the prompt required recording this as a separate design question).
- **D7 Soft-delete restore:** no restore API/UI/permission (not approved; not invented).

---

## 9. Changed files

Modified (29): `apps/web/src/components/layout/Sidebar.tsx`; `apps/web/src/components/members/WorkoutsTab.tsx`; `apps/web/src/components/members/WorkoutsTab.test.tsx`; `apps/web/src/lib/api.ts`; `apps/web/src/lib/attendance-api.ts`; `apps/web/src/lib/hooks.ts`; `apps/web/src/lib/index.ts`; `apps/web/src/lib/types.ts`; `apps/web/src/lib/workouts-api.ts`; `docs/event-contracts.md`; `docs/phase2-scoping-plan.md`; `docs/task-backlog.md`; `packages/contracts/src/events/workouts.events.ts`; `scripts/api-gate.js`; `src/pt/dto/assign-enrollment-workout-plan.dto.ts`; `src/pt/services/pt-enrollments.service.ts`; `src/pt/services/pt-enrollments.service.spec.ts`; `src/shared/storage/s3.service.ts`; `src/workouts/controllers/workouts-tab.controller.ts`; `src/workouts/dto/assign-plan.input.ts`; `src/workouts/dto/create-exercise.dto.ts`; `src/workouts/dto/create-workout-template.dto.ts`; `src/workouts/entities/exercise.entity.ts`; `src/workouts/entities/workout-plan-assignment.entity.ts`; `src/workouts/entities/workout-session.entity.ts`; `src/workouts/entities/workout-session-exercise.entity.ts`; `src/workouts/services/workouts.service.ts`; `src/workouts/services/workouts.service.spec.ts`; `src/workouts/workouts.module.ts`.

Added:
- `apps/web/src/app/workouts/page.tsx`
- `apps/web/src/lib/measurements-api.ts`
- `src/workouts/workouts.constants.ts`, `src/workouts/workouts.module.spec.ts`
- Controllers: `exercises.controller.ts`, `workout-day-templates.controller.ts`, `workout-plan-templates.controller.ts`, `workout-assignments.controller.ts`, `prescribed-days.controller.ts`, `workout-sessions.controller.ts`, `workout-progress-reviews.controller.ts`
- Services: `workouts-tenant.service.ts`, `exercise-library.service.ts`, `workout-templates.service.ts`, `workout-assignments.service.ts`, `workout-sessions.service.ts`, `workout-reviews.service.ts` + their specs + `workouts-p205.integration.spec.ts`
- DTOs: 17 new files under `src/workouts/dto/`
- Entities/enums: 17 new files under `src/workouts/entities/`
- Migrations: the five under `src/migrations/` and their five specs under `src/migrations/__specs__/`

No unrelated module was redesigned. `src/pt` changes are the minimum needed to forward the approved logging mode through the existing `PT → WorkoutsService.assignPlan()` contract.

---

## 10. Explicit acceptance statement

- **Implemented?** Yes for the supportable scope, on an uncommitted branch. Not declared complete.
- **Tier-2 verified?** Yes for the supportable scope: full hermetic suite, real-Postgres workouts suite, PT and migration suites, web typecheck/lint/test/build, and the full API gate (126/126). CI remains UNVERIFIED because no push was authorized.
- **Every approved requirement met?** No. B1, B2 and B3 (member identity, trainer/member role model, biometric source) are BLOCKED; the affected matrix rows are marked BLOCKED/PARTIAL. Smaller decisions D1–D7 remain with the owner.
- **Safe to merge?** Not until the owner rules on B1–B3 and the remaining decisions, and CI has run on a PR. No commit, push, PR or merge was performed.
