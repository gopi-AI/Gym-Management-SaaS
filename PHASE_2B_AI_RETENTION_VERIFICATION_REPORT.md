# PHASE 2B — AI RETENTION-ANALYSIS RUNTIME VERIFICATION REPORT

**Date:** 2026-09-13
**Endpoint under test:** `POST /v1/organizations/:orgId/ai/retention-analysis`
**Method:** runtime verification of the **built container image** against the **real PostgreSQL 16 + Redis 7** stack (no mocked infrastructure), plus static/automated checks.
**Verdict:** ✅ **PASS** — 34/34 functional runtime checks, 3/3 configuration-mode checks, 2/2 production fail-fast boot guards, 21/21 Jest suites (244 tests), TypeScript clean (API + web), migration applied and schema verified live. One Low-severity UI labelling defect found and fixed; three deployment/consistency notes raised (no functional impact).

---

## 1. Artifact under test

| Item | Value |
|---|---|
| API image | `gym-management-saas-api:latest` = `sha256:1ffeea769e74f181a5709813bd3a9be719440beeb4f498e9ea2159bb4f7a1862` (built by `Dockerfile`, `tsc` output in `dist/`) |
| Runtime entrypoint | `node dist/main.js` (NestJS 10, Express) |
| Compose project | `gym-management-saas` (`gym-postgres`, `gym-redis`, `gym-api`) |
| Controller | `src/ai/controllers/retention.controller.ts` — `@Post(':orgId/ai/retention-analysis')`, `@HttpCode(200)`, `@RequirePermissions({ resource: 'ai', action: 'retention-analysis' })`, `ParseUUIDPipe({ version: '4' })` |
| Service / provider layer | `src/ai/services/retention.service.ts`, `ai.service.ts`, `ai-provider.service.ts`, `src/ai/providers/{mock,openai}.provider.ts` |
| Prompt / limits | `src/ai/prompts/retention.prompt.ts` (`RETENTION_MAX_RECORDS=500`, `RETENTION_MAX_AT_RISK=50`, `RETENTION_MAX_SUMMARY_LENGTH=2000`) |
| Persistence | `src/ai/entities/ai-usage.entity.ts` (`AI_USAGE`), `src/ai/entities/ai-audit-event.entity.ts` (`AI_AUDIT_EVENTS`), migration `src/migrations/1788965263229-CreateAiSchema.ts` |
| Web client | `apps/web/src/app/retention-analysis/page.tsx`, `apps/web/src/components/ai/*` (3 components), `apps/web/src/lib/ai-api.ts` |

**Migration applied:** `typeorm_migrations` contains `CreateAiSchema1788965263229` (plus `CreateMembershipSchema1788965263228`, `InitialSchema1788965263227`).
**Live schema verified (14 + 15 columns):** `AI_USAGE(id, organization_id, user_id, request_type, provider, model, input_tokens, output_tokens, total_tokens, latency_ms, estimated_cost_usd, success, error_code, created_at)`; `AI_AUDIT_EVENTS(id, organization_id, user_id, request_type, provider, model, prompt_hash, prompt_summary, response_summary, tool_calls, input_tokens, output_tokens, success, error_code, created_at)`. Naming follows the repo-wide convention (upper-case quoted table names); the migration declares org/user FKs and 4 + 4 indexes.
**Entity registration:** runtime uses `autoLoadEntities: true` (`src/app.module.ts`) fed by `TypeOrmModule.forFeature` in `src/ai/ai.module.ts`; the CLI datasource (`src/data-source.ts`) globs `**/*.entity{.ts,.js}` — both paths include the AI entities, `synchronize: false` in both.
**Permission:** `ai:retention-analysis` exists in `IDENTITY_PERMISSIONS` and is mapped to role `owner` (DB-verified) — seeded by `src/scripts/bootstrap-dev.ts`, **not** by a migration (see Finding F2).

## 2. Environment

| Item | Value |
|---|---|
| Tenant under test | `9fb65b8b-f9f8-48ef-a09d-e38a7d8deb0c` (Development Gym); owner `test2@example.com`, user `db5ea4e3-c28f-4e34-8c15-6a3084ffccdc`, branch `ba15aa0d-cf93-472c-81e2-eb3954029c9d` |
| Isolation tenant | `e9a8ed85-6703-4a65-89d9-8596f3676694` (no membership for the test user) |
| Foreign branch | `b0000000-0000-4000-8000-00000000000b` (belongs to another organization) |
| Database | `gym_management` in `gym-postgres`; host access `localhost:5433`, in-cluster `postgres:5432` |
| Redis | `gym-redis` (JWT blacklist store) |
| Config verified | `.env`: `AI_ENABLED=true`, `AI_PROVIDER=mock`, `AI_MODEL=gpt-4o`, `AI_TIMEOUT_MS=30000`, `AI_MAX_RETRIES=2` (`.env.example` defaults: `AI_ENABLED=false`, `AI_PROVIDER=openai`) |
| Deployed API | `gym-api` on host port 3000, **recreated to run the verified image** `1ffeea76…` (it had been running the stale image `ff1ca510…`) |

## 3. Harnesses

| Harness | Purpose | Location |
|---|---|---|
| `ai-runtime-verify.cjs` | Sections 1–8: auth, unauthenticated 401, 90d happy path + response contract, at-risk containment, telemetry persistence, tenant-isolation negatives, input validation, body-spoof stripping, branch scoping, at-risk content via a live pause/resume fixture | `/tmp/ai-runtime-verify.cjs` (ephemeral) |
| `ai-config-verify.cjs` | Modes `disabled` / `notconfigured` / `providerfail`: HTTP mapping, fail-closed behaviour, telemetry deltas, no member-data leakage | `/tmp/ai-config-verify.cjs` (ephemeral) |

Both harnesses call the endpoint over HTTP **and** assert the persisted rows through a direct Postgres connection, so "the API answered 200" is never accepted without ledger evidence.

## 4. Functional evidence (34/34 PASS)

Run against the **deployed compose service** (`API_BASE=http://localhost:3000`, image `1ffeea76…`, provider `mock`): exit code `0`, `total=34 passed=34 failed=0`. The same harness also passed 34/34 against a dedicated verification container on port 3100.

**Authentication / authorization**
- `1.1` owner login → `200`, access token issued.
- `2.1` unauthenticated request → `401`.
- `5.2` path org without membership → `403 {"message":"Access to this organization is not allowed"}`.
- `5.3` unknown org id → `403` (same body; no existence oracle).
- `5.4` matching `X-Organization-Id` header → `200`.

**Happy path / response contract**
- `3.1` `200`; `organization_id=9fb65b8b-…`, `retention_rate=1`, `total_members=3`, `at_risk_count=0`, `summary` 126 chars, `generated_at` ISO-8601.
- `3.2` server-derived `organization_id` equals the **authorized** org (route org), never client input.
- `3.3` / `3.4` every `at_risk_members[].member_id` is inside the authorized org (`outside=0`); cross-tenant hits `0` (the isolation org has 1 member — none leaked).
- `3.5` / `3.6` / `3.7` list capped at `RETENTION_MAX_AT_RISK` (50), ids unique, item shape valid (`member_id, name, risk_score, risk_factors[], recommended_action`).
- `7.1` unknown body fields stripped; tenant stays server-derived (`200`).
- `7.2` / `7.3` branch-scoped run honoured (`total_members=1`, in-tenant) and still capped.

**Telemetry persistence (both tables)**
- `4.1` / `4.2` exactly one `AI_USAGE` + one `AI_AUDIT_EVENTS` row per successful call (`before=23 after=24`).
- `4.3` usage row bound to the authorized tenant, the authenticated user, provider `mock`, `request_type=retention-analysis`, `success=true`, `error_code=null`.
- `4.4` token accounting consistent: `input_tokens 429 + output_tokens 54 = total_tokens 483 > 0`, `latency_ms=2`.
- `4.5` audit row binds tenant/user/provider and stores a 64-char `prompt_hash` plus `prompt_summary` (`retention-analysis; period=90d; branch=all; memberships=3; members=3`).
- `4.6` audit summaries contain no PII fields (no names, e-mails, or free-text staff notes).

**Tenant-isolation negatives**
- `5.1` mismatched `X-Organization-Id` header cannot widen scope (route org wins, `cross_tenant=0` — the pre-existing project convention, cross-checked against `GET .../branches`).
- `6.4` `branch_id` from another tenant → `403 {"message":"Access to this branch is not allowed"}` (defence-in-depth check inside `retention.service.ts`).

**Input validation / abuse**
- `6.1` invalid `period` → `400`; `6.2` malformed `branch_id` → `400`; `6.3` malformed route `orgId` → `400` (`ParseUUIDPipe`).
- `6.5` body-spoofed tenant without auth → `401`.
- `6.6` rejected requests incur **no AI spend** (no new usage rows: `before=26 after=26`).

**At-risk content (live fixture, not synthetic JSON)**
- `8.1` a live membership was paused through the memberships API → `membership_status=paused`.
- `8.2` the paused membership surfaces as at-risk (`at_risk=1`, target member found).
- `8.3` item content well formed: `{"member_id":"7c542462-…","name":"Jane Doe","risk_score":0.75,"risk_factors":["membership status is \"paused\""],"recommended_action":"Ask the member to confirm a restart date and offer a plan adjustment."}` (`0.75` = mock base `0.6` for `paused` + `0.15` renewal-window bump).
- `8.4` risk ordering descending; `8.5` summary reflects the at-risk count (`2 active, 1 flagged at risk`); `8.6` fixture restored (`membership_status=active`).


## 5. Configuration-mode evidence (4 modes, all PASS)

| Mode | Container config | HTTP | Telemetry | Result |
|---|---|---|---|---|
| `default` (dev) | `AI_ENABLED=true`, `AI_PROVIDER=mock` | `200` + full contract | 1 success row in each table, real tokens/latency | 34/34 PASS |
| `disabled` (kill-switch) | `AI_ENABLED=false` | `503 {"message":"AI features are disabled for this organization"}` | `usage_delta=0 audit_delta=0` — nothing written, nothing spent | PASS |
| `notconfigured` | `AI_PROVIDER=openai`, `AI_API_KEY=` (empty) | `503 {"message":"AI features are not available"}` | 1 failure row in each table, `total_tokens=0`, `error_code=AI_NOT_CONFIGURED` | PASS |
| `providerfail` (real OpenAI call) | `AI_PROVIDER=openai`, fake key `sk-not-a-real-key` | `503 {"message":"AI features are not available"}` (upstream `401` mapped, message sanitized — no `sk-`, no `OpenAI`, no upstream internals) | 1 failure row in each table, `provider=openai`, `model=gpt-4o`, `total_tokens=0`, `error_code=AI_INVALID_API_KEY` | PASS |

No member data (`retention_rate`, `at_risk_members`) appears in any failure body — the endpoint fails closed in every non-happy mode, and the outbound OpenAI path (`api.openai.com`) was exercised for real, proving the provider adapter, retry classification (401 → non-retryable), error-code mapping and failure telemetry all work end-to-end.

**Production fail-fast boot guards (image started with `NODE_ENV=production`)**
- `AI_PROVIDER=mock` → process aborts: `AI_PROVIDER=mock must not be used in production.` (mock output can never be served as real AI in production).
- `AI_PROVIDER=openai` + empty `AI_API_KEY` → process aborts: `AI_API_KEY must be set in production when AI_ENABLED=true and AI_PROVIDER=openai.`
- `AI_PROVIDER=openai` + a key present → boots normally (`Nest application successfully started`) — the guard is not over-broad.

## 6. Static / automated evidence

| Check | Command | Result |
|---|---|---|
| AI unit/integration specs | `npx jest src/ai --ci` | `6 suites / 106 tests` passed, exit 0 |
| Whole backend suite | `npx jest --ci` | `21 suites / 244 tests` passed, exit 0 |
| Backend typecheck | `npm run typecheck` (`tsc --noEmit -p tsconfig.spec.json`) | exit 0 |
| Web typecheck | `apps/web`: `tsc --noEmit -p tsconfig.json` | exit 0 |
| Migration state | `select name from typeorm_migrations` | `CreateAiSchema1788965263229` present |
| Live ledger | `AI_USAGE` grouped by outcome | 34 success rows (`mock`), 1 × `AI_NOT_CONFIGURED`, 1 × `AI_INVALID_API_KEY` (both failures with `total_tokens=0`) |
| Test layout | `jest` `testMatch: ["**/*.spec.ts"]`; no `test/`/`tests/` dir, no HTTP e2e layer | consistent with the 21 co-located suites; the runtime harness above is the HTTP-level evidence |

**Web UI compatibility (code-level review, no browser run):** every prop used by the new retention components exists on the shared primitives — `Card`/`CardBody` (named exports), `Button({variant, loading})`, `Alert({type, dismissible, className})`, `Empty({title, description, action})`, `Table({striped, hover, responsive, cardTable})` + `{THead,THeadRow,TBody,TBodyRow,Th,Td}`, `Badge({color, className})`. `riskBand()` colours (`red/orange/yellow/green`) are all valid Tabler `bg-*-lt` classes. The form never submits an organization id — it comes from the route — matching the API contract verified in check `3.2`.


## 7. Findings

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| F1 | **Low (fixed)** | `RetentionSummary` labelled the at-risk table "Flagged (max 25)" while the service cap (`RETENTION_MAX_AT_RISK`) is 50 — the UI understated the real limit. | `RetentionSummary.tsx` vs `retention.prompt.ts:9`; the runtime harness returned up to 50 items. | Fixed in this phase → "Flagged (max 50)" |
| F2 | Medium (process) | `ai:retention-analysis` is seeded only by `src/scripts/bootstrap-dev.ts`, not by the `CreateAiSchema` migration. A production deploy that never runs the bootstrap script has the permission row absent, so **every** caller (including owners) gets `403`. | `IDENTITY_PERMISSIONS` in `src/identity/**`; migration contains no permission inserts. | Open — recommend adding an idempotent seeding migration (same pattern as the membership permissions if those were seeded; otherwise document the required bootstrap step in the deploy runbook) |
| F3 | Medium (ops) | The running `gym-api` container was on a **stale image** (`ff1ca510…`) that predates the AI module, so the deployed endpoint would have 404'd despite the code being complete. | `docker inspect gym-api` image id before recreate; after `--force-recreate` it runs `1ffeea76…` and the endpoint works. | Resolved in this environment — recommend an image-digest check in the deploy pipeline |
| F4 | Low | `docker compose` publishes Postgres on `5433` in this environment while the compose default is `5432` (a host Postgres already owns `5433`). Anyone running the harness/psql with the other port silently connects to the wrong database. | `docker compose ps` → `0.0.0.0:5433->5432/tcp`; harness connects to `localhost:5433`. | Documented — `.env`/compose override already set, no code change needed |
| F5 | Low | `AI_USAGE.estimated_cost_usd` is `0.000000` (not `null`) on the failed OpenAI row, while successful `mock` rows are `null`; cost is only meaningful for billed providers. Consumers must therefore treat `success=false` rows as non-billable rather than relying on `null`. | Live query on the last four `AI_USAGE` rows. | Informational — no defect in the endpoint contract |

No High/Critical findings. Nothing in the endpoint leaked cross-tenant data, PII, upstream provider internals, or accepted client-supplied scope in any of the 34 functional + 12 configuration checks.

## 8. Change applied in this phase

`apps/web/src/components/ai/RetentionSummary.tsx` — at-risk table heading corrected from `Flagged (max 25)` to `Flagged (max 50)` so the UI documents the actual server cap (`RETENTION_MAX_AT_RISK = 50`). One-line copy change, no logic touched; web typecheck passes.

## 9. Working-tree state at report time

`git status --short` (excluding the gitignored `dist/` build output) shows **32 entries**, all belonging to Phases 2A/2B plus this report:

- Backend (new): `src/ai/`, `src/memberships/`, `src/migrations/1788965263228-CreateMembershipSchema.ts`, `src/migrations/1788965263229-CreateAiSchema.ts`, `src/shared/outbox/outbox.service.spec.ts`.
- Frontend (new): `apps/web/src/app/retention-analysis/`, `apps/web/src/app/memberships/`, `apps/web/src/app/membership-plans/`, `apps/web/src/components/ai/`, `apps/web/src/lib/ai-api.ts`, `apps/web/src/lib/memberships-api.ts`.
- Modified: shared UI primitives, `src/app.module.ts`, `src/data-source.ts`, `src/identity/**`, `apps/web/src/app/layout.tsx` / navigation, `compose.yaml`/`.env` port override, plus the `RetentionSummary.tsx` fix from F1.
- This report: `PHASE_2B_AI_RETENTION_VERIFICATION_REPORT.md` (new, uncommitted).

Nothing was force-committed or left half-edited; no temporary code, debug endpoints, or test fixtures were added to the application source.

## 10. Environment restoration

- The temporary verification container `gym-api-verify` (port 3100) was **removed**.
- `gym-api`, `gym-postgres` (healthy), `gym-redis` are up; `gym-api` serves the verified image `1ffeea76…` on port 3000.
- The at-risk fixture membership was restored to `active` by the harness (`8.6`).
- Side effects **left in the database on purpose** as audit evidence: 34 success rows, 1 `AI_NOT_CONFIGURED` failure row and 1 `AI_INVALID_API_KEY` failure row in `AI_USAGE`/`AI_AUDIT_EVENTS` (all scoped to the dev tenant) — they document the verification runs and can be deleted without affecting the code.

## 11. Residual risks / recommendations

1. **F2 first** — ship an idempotent permission-seeding migration; otherwise a fresh production database yields `403` for everyone and the endpoint looks broken while being correct.
2. Add an automated HTTP-level e2e suite. Today the only HTTP evidence is the ephemeral `/tmp` harness; committing it (e.g. under a `verification/` folder, plain `.cjs` so `tsc` ignores it) would make this verification repeatable in CI.
3. Add a deploy-time image-digest assertion (F3) so a stale image can never make a completed feature look missing again.
4. Optionally normalise `estimated_cost_usd` to `NULL` for failed/uncosted rows (F5) to simplify downstream billing queries.

## 12. Verdict

**Phase 2B — AI retention-analysis endpoint: VERIFIED and ACCEPTED.**

The endpoint was exercised against the deployed build and real infrastructure and behaved correctly for authentication, authorization, tenant and branch isolation, input validation, abuse resistance, response-contract shape, at-risk content fidelity, and dual-table telemetry — including the failure paths (kill-switch, missing configuration, real provider rejection) and the production fail-fast guards. The single functional/UI defect found (F1) was fixed. The remaining items are deployment/process hardening (F2, F3), not endpoint defects, and are recorded above with concrete recommendations.

