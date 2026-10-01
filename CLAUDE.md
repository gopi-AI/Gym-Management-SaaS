# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Multi-tenant Gym Management SaaS: a NestJS modular monolith (PostgreSQL/TypeORM, Redis, transactional outbox) with a Next.js frontend and a shared event-contracts package in one npm workspace.

Work is organised into numbered phases (`docs/implementation-roadmap.md`). **On `main`, Phases 0–3 are implemented; Phase 4 and later are not.** `docs/task-backlog.md` is the authoritative per-item status list, and `docs/phase3-status-report.md` / `docs/phase3-completion-checklist-report.md` record what is verified, what is partial, and which design questions are still unruled — read the dated "superseded readings" banners in those reports before trusting any status claim inside them.

Node 24 (`.nvmrc`, CI matrix, and `Dockerfile` all pin it).

Two long-lived sibling worktrees of this same repository exist at `../gym-saas-phase4` (branch `phase-4`) and `../gym-saas-phase6` (branch `phase-6`). `phase-6` contains `main`'s history but is **not** an ancestor of it; neither branch is checked out here. `main` is the deliverable baseline — leave those worktrees alone unless you are asked to work there.

## Layout

| Path | What it is |
|------|-----------|
| `src/` (repo root) | The NestJS backend. Built by the root `tsconfig.json`. |
| `apps/web/` | Next.js 15 App Router frontend (`@gym-management/web`), dev server on **port 3001**. |
| `packages/contracts/` | `@gym-management/contracts` — domain event payloads and the `EventEnvelope`. |
| `docs/` | Design plans (`*-plan.md`), the per-item backlog, and the verification reports. |
| `scripts/` | Build-provenance stamp and the dev-database guard. |

`docs/architecture.md` and `docs/domain-map.md` describe the **full target design**, including bounded contexts that have no code yet — `scheduling`, `notifications`, `reports`, and the C#/SQLite edge-sync agent. Treat them as intent, not inventory: the shipped modules are the ones under `src/`.

## Commands

```bash
# Verification gates (this is what CI runs, in this order)
npm run typecheck                  # tsc --noEmit -p tsconfig.spec.json
npm run lint                       # eslint . --ext .ts
cd apps/web && npm run typecheck   # frontend typecheck
npx jest --passWithNoTests         # full backend suite

# Single test — specs are colocated with their source file
npx jest src/members/services/members.service.spec.ts
npx jest -t "rejects a cross-organization discount"
npx jest src/memberships            # everything under a path

npm run build                      # build:info (writes dist/build-info.json) THEN tsc
npm run build:info                 # the fingerprint stamp alone; plain Node, no deps needed

# Database (see "Running DB commands" below before using these)
npm run migration:generate -- src/migrations/<Timestamp>-<Name>
npm run migration:run
npm run migration:revert
npm run bootstrap:dev              # seeds dev permissions, owner role, org, user-role link

# Frontend
cd apps/web && npm run dev         # port 3001
```

Local services: `docker compose up -d postgres redis`. `.env.example` publishes Postgres on host port **5433** (deliberately not 5432, to avoid a native host cluster).

### Testing model

`npm test` is hermetic — `jest.config.js` declares no `setupFiles`, no `moduleNameMapper`, and nothing loads `.env`, so the suite needs no Postgres or Redis. Every spec mocks TypeORM repositories.

Three spec groups behave differently:

- **Default hermetic suite** (112 spec files; 109 run + the 3 gated integration specs). Specs are colocated with source as `<source-basename>.spec.ts`. `collectCoverageFrom` is `src/**` only. A full run takes roughly 1 to 1.5 minutes on the dev machine (measured 63 s and 73 s on 2026-10-02; varies with load) and intermittently prints `A worker process has failed to exit gracefully` — a known teardown leak, not a failure; the command still exits 0.
- **Migrations** — specs live in `src/migrations/__specs__/` rather than colocated, pass a `jest.fn()` query runner into `up()`, and assert SQL strings. `__specs__/migration-loader.contract.spec.ts` statically enforces the TypeORM loader contract (exactly one exported class per migration file, no `export function` in the glob, 13-digit timestamp suffix). **A new migration that violates it breaks that spec.**
- **Real-DB integration specs** — the three `*.integration.spec.ts` (`src/memberships/services/` ×2 and `src/inventory/services/`) are skipped unless `RUN_DB_INTEGRATION=1`, and then need a pre-migrated throwaway database plus all five `DB_*` variables exported. (`src/loyalty/services/loyalty-accrual.integration.spec.ts` is named "integration" but is mock-based.)

`src/app.boot.spec.ts` compiles the real `AppModule` with the TypeORM `DataSource` and `CACHE_MANAGER` stubbed and Stripe keys unset. It is the only test that catches missing module `exports` / provider-constructor failures — the hand-assembled module specs cannot. Keep it green.

### Running DB commands

The TypeORM CLI (`src/data-source.ts`) and `bootstrap-dev.ts` do **not** load `.env` the way the app does; without help they fall back to `localhost:5432` and can hit the wrong server. The supported path is the guard script, which loads `.env`, exports only the `DB_*` vars, and refuses to run unless the target is loopback and on the port Docker actually publishes:

```bash
scripts/dev-db-env.sh npm run migration:run
scripts/dev-db-env.sh --show            # print the resolved target and stop
scripts/dev-db-env.sh --probe           # psql identity check inside the container
```

The API/integration gate (D15) boots the real app on a throwaway database and exercises the
Phase 3 surface over HTTP. It needs `docker compose up -d postgres redis`; it creates and drops
its own `gym_gate_*` database and never opens `DB_DATABASE`:

```bash
npm run api:gate                        # 69 checks; exits non-zero on any failure
node scripts/api-gate.js --list-checks  # the check inventory, no database needed
node scripts/api-gate.js --only=inventory,webhook --keep-on-failure
```

Migrations must be applied before `bootstrap:dev`. At runtime the app only auto-runs migrations when `DB_MIGRATIONS_RUN=true` (default `false`).

## Architecture

### Request pipeline

Both guards are registered **globally** (`src/shared/auth/auth.module.ts`), so **every route is authenticated by default**:

1. `JwtAuthGuard` — verifies the bearer token with `JWT_SECRET`, requires `payload.tokenType === 'access'`, and checks a Redis blacklist. The blacklist read **fails closed** (Redis unreachable → 401).
2. `PermissionsGuard` — `@RequirePermissions({ resource, action })` per handler. **A handler with no decorator passes for any authenticated user**; permissions are not implied by authentication.
3. `TenantContextInterceptor` (`src/tenancy/tenancy.module.ts`, `APP_INTERCEPTOR`) — re-verifies the `Authorization` header independently (it does not read `req.user`), reads `X-Organization-Id`, and runs the rest of the pipeline inside an `AsyncLocalStorage` tenant context.

Also global: `ValidationPipe({ whitelist: true, transform: true })` in `src/main.ts`, and `SentryGlobalFilter` as the sole exception filter. `src/main.ts` imports `./instrument` first so Sentry can patch later module loads.

`@Public()` is the only supported opt-out. It is used by exactly three things: the auth controller's login/register/refresh/MFA routes, the health controller, and the payment-gateway webhook. `@CurrentUser()` injects `req.user` as `AuthenticatedUser`.

CORS allows exactly `http://localhost:3001` with `Content-Type`, `Authorization`, `X-Organization-Id`. Adding a custom request header means editing that list in `src/main.ts`.

There is no Swagger setup and no global route prefix — `@nestjs/swagger` is a dependency but `SwaggerModule` is never used, and controllers carry their own `v1/...` prefix.

### Multi-tenancy — application-layer only (RLS is deferred, permanently)

Tenant isolation is enforced **entirely by explicit `organization_id` predicates in every query**. There is no RLS, no session GUC, and **no database-level backstop**. This was evaluated and formally ruled on 2026-09-26 (`docs/database-plan.md` §"Tenant Isolation — Application-Layer Enforcement (RLS Deferred)"): TypeORM's shared connection pool provides no per-request connection affinity, so `SET LOCAL` cannot reliably carry the policy GUC. **Do not add opportunistic RLS to new tables.**

Consequences for new code:

- `TenantContextService` is **not `@Global()`** — feature modules must import `TenancyModule` explicitly.
- There is no `TenantScopedRepository` base class. The "scoped repository" is a convention: inject `TenantContextService`, resolve the org, and pass `organization_id` into your own `where` clauses.
- Two context fields carry deliberately different trust: `requestedOrganizationId` comes from the `X-Organization-Id` header and is **only a request, not proof of authorization**; `organizationId`/`branchId` are set only after `requireOrganizationAccess()` / `requireBranchAccess()` succeed.
- **Scope every predicate, including updates and deletes** (e.g. `where: { id, organization_id }`), so a row cannot be moved or mutated across tenants between a check and a write.
- Never take `organizationId` from client input when publishing events — derive it from the authorized context.

### Events — the transactional outbox

Domain events are written to `shared.outbox` **in the same transaction as the domain write**, then dispatched in-process by `OutboxPoller` (a locked batch lease, `MAX_ATTEMPTS = 10`, then dead-letter). Never publish to a broker directly from a transactional service.

`OutboxService.saveEventEnvelope(...)` takes an optional final `manager` argument. **Pass the transaction's `manager`** — writing through the ambient repository instead commits the event independently and leaves an orphan event when the domain transaction rolls back.

Consumers implement `OnModuleInit` and register with the **global** `EventHandlerRegistry` under the key `"{eventType}.{eventVersion}"`. Two behaviours to know:

- Registrations are additive — every handler for a key runs, in registration order.
- **An event with no registered handler is still marked processed.** A missing consumer fails silently rather than stalling the row.

`src/shared/inbox/` is scaffolded (entity + service with an idempotency primitive) but **entirely unwired** — it is groundwork for the RabbitMQ target described in `docs/event-contracts.md`, not a live mechanism. `EventHandlerRegistry` is the deliberate in-process stand-in for that broker.

### Event contracts — a three-way lockstep, maintained by hand

The backend **does not import** `packages/contracts` at build time (`tsconfig.json` sets `rootDir: ./src` and excludes `packages`), and `apps/web` does not depend on it either. Only `tsconfig.spec.json` and one test reach into it. Instead, every domain event is defined in three places that **must stay in sync manually**:

1. `packages/contracts/src/events/<domain>.events.ts` — the payload interfaces.
2. `src/<domain>/<domain>.constants.ts` — the runtime constants the backend actually uses (`<DOMAIN>_EVENT_TYPES`, `<DOMAIN>_EVENT_VERSION`). `src/shared/outbox/outbox.service.ts` mirrors `EventEnvelope` the same way.
3. `docs/event-contracts.md` — the prose contract.

Contract-file conventions: `<Domain>Payload` interfaces (money and dates as **strings**), `<EventName>Event` aliases over `EventEnvelope<T>`, a `<Domain>Event` union, a `<DOMAIN>_EVENT_TYPES` const map. `membership.events.ts` uses unprefixed `EVENT_TYPES` / `EVENT_VERSIONS` and is the only file the backend imports. Event names are normally unversioned PascalCase with the version carried separately — `pt.events.ts` is the exception (version baked into the name string).

Note the package is not consumable as published: `main`/`types` point at a `dist/index.js` that does not exist, and there is no `exports` map.

### Background workers

Workers extend `BackgroundWorker` (`src/shared/workers/background-worker.ts`) and implement `workerName`, `workerInstanceKey`, and `runOnce()` — never override `tick()`. Registration is dynamic via `SchedulerRegistry` rather than a static `@Interval()` decorator, so a disabled worker costs no timer; `tick()` cannot overlap itself and never throws.

**Every worker defaults to OFF.** Enablement is two-level: the master switch `WORKERS_ENABLED` (default `false`), overridden per worker by `WORKERS_<NAME>_ENABLED` (per-worker wins). Cadence comes from `WORKERS_<NAME>_INTERVAL_MS`, clamped to `MIN_WORKER_INTERVAL_MS`. Intervals and batch sizes are centralised in `src/shared/workers/worker-config.ts`. Workers own no business logic — they only call domain services, so each needs a `WorkersModule` wiring entry.

### Module conventions

Each domain module is `src/<domain>/` with `controllers/`, `dto/`, `entities/`, `services/`, a `<domain>.module.ts`, and a `<domain>.constants.ts` where it has enum-like values or event names. Cross-module dependencies are explicit NestJS imports; `TenancyModule` in particular must be imported wherever tenant context is needed.

Entities are named `<SCHEMA_UPPER>_<TABLE_UPPER>` (e.g. `FINANCE_INVOICES`, `MEMBERS_MEMBERS`), with `shared.outbox` / `shared.inbox` as the dot-separated exception. Schema is migration-only: `synchronize` is hard-disabled in both `src/app.module.ts` and `src/data-source.ts`.

Some domain values live in TypeScript constants rather than being retyped in SQL — e.g. the ledger views take status lists from `src/finance/finance.constants.ts`, and a `__specs__` entry pins that lockstep. Follow that pattern for new SQL that encodes a state machine.

### Domain modules

| Module | Owns | Notes |
|--------|------|-------|
| `tenancy` | organizations, branches, tenant settings | Also registers the global `TenantContextInterceptor`. Exports services only, never repositories — the single-legal-write-path rule. |
| `identity` | users, roles, permissions, MFA secrets, auth tokens | `IdentityService.hasPermission()` backs `PermissionsGuard`. |
| `members` | members, profiles, identifiers, consents, documents, measurements | Member documents are the only current S3 consumer. |
| `memberships` | plans, memberships, history, discounts | Discounts are defined here and applied by finance (discount-before-tax is a ruled, fixed ordering). Renewal on expiry is service/worker-only — no HTTP route. |
| `finance` | invoices, items, payments, refunds, credit notes, tax, dunning, webhook events, payment methods | The "ledger" is **not** a double-entry journal — no ledger table exists, and `docs/architecture.md`'s append-only-ledger ADR is design intent, not shipped behaviour. `LedgerService` reads three **plain** views (`V_FINANCE_*`), never materialized, derived from `FINANCE_INVOICES` and `FINANCE_PAYMENTS`; nothing in the module writes. Payment status/state lists come from `finance.constants.ts` so the view SQL cannot drift from the write-path state machines. |
| `attendance` | attendance events, attendance records, access decisions | |
| `crm` | leads, lead activities, sources, stages, conversions, follow-ups, SLA policies/breaches | |
| `inventory` | items, lots, suppliers, transactions, purchase orders | Lot expiry is tracked but nothing schedules or exposes expiry checking. |
| `pt` | trainers, packages, enrollments, sessions, commissions, payout runs/items | Commissions are clawed back atomically inside enrollment cancellation, preserving the snapshot. |
| `loyalty` | accounts, rules, transactions, rewards | Consumes attendance events via `EventHandlerRegistry`; owns its own expiry worker. |
| `workouts`, `diet` | exercise/template/assignment and diet-plan/meal/log tables | |
| `ai` | usage, audit events, prompts, providers | Provider is `mock` or `openai` behind an abstraction; usage limits are enforced in Redis (over-limit → 429, Redis down → 503). The shipped AI features are member-retention analysis and plan performance. |
| `shared` | auth, tenant, outbox, inbox, event-handler, workers, crypto, storage, health, utils | |

Optional integrations degrade rather than fail: the Stripe adapter reports `isConfigured === false` with no key and `PAYMENT_GATEWAY` falls back to `UnavailablePaymentGateway`; Sentry no-ops without `SENTRY_DSN`. **Any provider whose constructor builds an SDK client must guard on the key** — an unguarded `new Stripe('')` throws during DI and takes down the entire app, which is exactly how a past boot blocker happened.

### Frontend (`apps/web`)

Next.js App Router, Tabler/Bootstrap CSS, TanStack React Query as the only state layer, all pages client-rendered (`AuthGuard` is a UX-only client redirect — there is no middleware or server-side session).

All HTTP goes through `src/lib/api.ts`: base URL from `NEXT_PUBLIC_API_URL`, tokens in `localStorage`, `X-Organization-Id` header for tenant context, and a single deduped 401 → refresh → retry cycle. Data fetching lives in React Query hooks in `src/lib/hooks.ts`; **components must not call the API directly** — this is a `.clinerules` requirement. `src/lib/types.ts` re-declares the backend response shapes by hand rather than importing the contracts package.

Phase 3 added no frontend surface, so the UI covers Phase 0–2 scope only (auth, members, memberships, plans, payments, check-in, branches, organizations, settings, AI).

## Repository rules

`.clinerules` at the repo root is the normative rule set for this project — read it in full. The parts most often relevant:

- **The repository is law.** Do not invent entities, routes, permissions, fields, or architectural patterns. Inspect the existing code first; if a required pattern or service cannot be found, stop and report `"NOT DETERMINED FROM CURRENT REPOSITORY"` rather than designing one.
- Prefer the smallest structural change; no unrelated refactors; never create a parallel authorization, tenancy, or eventing system.
- Follow the tenancy chain unchanged: Auth Identity → Tenant Context → RBAC → Scoped Service → Scoped DB Query.
- No raw SQL unless the task or an existing migration/view mechanism requires it. No entity spreading (`...dto`) on sensitive updates.
- **Never fake a test, build, typecheck, migration, or runtime result.** Run the command. If you cannot, report it as `UNVERIFIED`. Equally: never report a commit, push, or other git operation as complete by *describing* its result — paste the raw output of the verifying command, and for a push confirm against a fresh `git ls-remote` rather than the push's exit code.
- Never `git reset --hard` or `git clean -fd`. Don't commit unless explicitly asked.
- Never present a prior analysis or artifact as already existing unless you can point to the exact file, commit, or quoted section it lives in. After a context or session boundary, treat your own earlier summary as a claim to re-verify against the repository, not a fact to build on.

## Gotchas

- **`ValidationPipe({ whitelist: true })` silently drops undecorated DTO properties.** A field with no class-validator decorator never reaches the handler.
- **`@Type(() => Boolean)` inverts query params** — `?is_active=false` becomes `true`. Use `@Transform(({ value }) => value === true || value === 'true')`, the form already used by `QueryTaxRateDto.is_active` and `QueryInvoiceDto.outstanding_only`. This was a filed defect (DEF-01) and a spec now pins it.
- **Stripe keys and S3 settings are documented** (`.env.example` — Stripe at lines 70/75, the object-storage section below them); this bullet read "undocumented / P3-10 not started" until the Phase 3 sign-off reconciled it. What remains true: `S3Service` reads `process.env` directly rather than `ConfigService` (ratified as shipped, `docs/phase3-scoping-plan.md` §15.2 **T1.4**), and `buildKey()` is still hard-coded to the member-document prefix — the CRM/inventory key builders are deferred until a consumer exists (D1), so a non-member upload would still land under a member key prefix.
- `MFA_ENCRYPTION_KEY` is mandatory in production (`validateEnv` throws at boot); dev derives a marked deterministic fallback. Ciphertext carries a `v1:` prefix.
- S3 writes are ordered **upload first, DB row second**, with best-effort cleanup — an orphan object is acceptable, a row pointing at a missing object is not.
- `dist/build-info.json` is generated by `npm run build`, not checked in; the health endpoint tolerates its absence. The Dockerfile fails the build when `GIT_REVISION` is absent or not a hex revision.
- Several root-level files are tracked planning artifacts, not source: `prompt.txt` and the two `PHASE_2_*_VERIFICATION_REPORT.md` files. `result`, `frontend-precommit-review.txt`, and `*.tsbuildinfo` are gitignored.
