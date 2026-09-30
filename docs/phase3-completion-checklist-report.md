# Phase 3 Completion Checklist Report

**Date:** 2026-09-26 · **Last updated:** 2026-09-27 (DEF-01 fix — §4.5, re-verified gates §1.1)
**Scope:** `docs/phase3-scoping-plan.md` (§1–§15), `docs/task-backlog.md` (all `P3-*` items + `DEF-01`), and the working tree of `main`.
**Method:** read-only inspection of the repository plus commands run in this session; every claim below is backed by a command whose output is reproduced or referenced. Anything not reproduced in this session is marked **UNVERIFIED**.
**Nature:** validation/reporting, plus one code fix. The 2026-09-26 pass was read-only and modified no application source. On 2026-09-27 the one fully-unblocked defect, DEF-01, was fixed (`src/memberships/dto/query-membership-plan.dto.ts` plus a new spec) and every gate was re-run (§1.1). One new document (this file) was added.

**Legend:** ✅ complete (committed) · 🟡 complete but uncommitted · 🚧 partial · ❌ missing · ⚠️ risk/observation · 📋 not required by scope · 🔍 verified this session · ⏳ carried forward (not re-run)

---

## 0. State as of `021dc160` — 2026-09-28 (read this before the dated sections below)

**Every Phase 3 item is now committed. Every `uncommitted` / `untracked` label below is dated and superseded.**

The commit boundary this report was written around no longer exists. Twelve of the thirteen Phase 3 items are committed on `main`; the thirteenth — **P3-10 — is not started**. Where each item landed (`git log`, 2026-09-28):

| Item | Committed in |
|------|--------------|
| P3-01 Financial Ledger Read Model | `24f1a300` (present at the `c7f84c08` baseline) |
| P3-02 Refunds & Credit Notes | `8f305a60` (present at the `c7f84c08` baseline) |
| P3-03 Payment Gateway Integration | `b4b6464d` |
| P3-04 Tax Handling | `eab95ced` (present at the `c7f84c08` baseline) |
| P3-04b Membership Discounts | `021dc160` |
| P3-05 Inventory Management | `b4b6464d` |
| P3-06 CRM Lead Management | `b4b6464d` |
| P3-07 Follow-ups & SLAs | `b4b6464d` |
| P3-08 Dunning | `b4b6464d` |
| P3-09 Recurring Billing / Renewal | `e16c1118` |
| **P3-10 Object Storage Configuration** | **— not started** (no `@Global()`, no non-member key builders, no S3 env docs) |
| P3-11 PT Commission Clawback | `823c00d5` |
| P3-12 Payout Batching | `fa8c5212` |
| DEF-01 `is_active` inversion | `3dee318a` |
| RLS deferral (`phase3-status-report.md` §6 Q11) | `d6c26095` |

**Committed at the `a5a32f77` baseline — the tree is clean and nothing is uncommitted.** Every path this section previously listed has since landed. Measured 2026-09-30:

```
$ git rev-parse HEAD
a5a32f77f0a05d1080d6a73cc2a46b66ac4c4885
$ git status --porcelain --untracked-files=all
(empty)
$ git rev-list origin/main..main --count
0
```

`docs/event-contracts.md`, `packages/contracts/src/events/crm.events.ts` and `packages/contracts/src/events/inventory.events.ts` were committed in **`08978034`** (`docs/event-contracts.md` `56/0`, `crm.events.ts` `30/0`, `inventory.events.ts` `53/0`). This report, previously **untracked** so that it had no committed baseline at all, was committed in **`bd19fca7`** (status `A`). The 2026-09-28 reading of "7 paths / `rev-list` → 8" is superseded and retained only as history. *(Reconciled 2026-09-30: every count quoted in this block is the `a5a32f77` baseline.)*

**Superseded readings.** §2's `git status --porcelain | wc -l → 15`, its "Unpushed commits (6)" and its verbatim uncommitted-path list; §1's "the uncommitted P3-04b migration"; and every `🟡` / `(uncommitted)` / `(untracked)` label in §3, §4 and §5 record the tree on **2026-09-26 / 2026-09-27**. They are retained as history, not as current status. The item statuses in §3/§4 and the §7 checklist have been updated to the committed state above.

**Unchanged by the commits:** P3-10 not started; the four P3-05 endpoints and two P3-05 workers still absent; the missing P3-04b entity spec; the absent operator renewal route; the undocumented Stripe keys; the backlog gaps; and the open §15 rulings. A commit changes where the code lives, not what it does.

**Classifier provenance — corrected 2026-09-29.** An earlier pass recorded an "A/B/C" proof-claim classifier and its result as `A/B/C = 0`. That classifier could not be located: a search of the shell history (`~/.bash_history` and `~/.bash_history-04167.tmp`), of every report under `docs/`, and of the scripts in the repo (`scripts/`, plus a repo-wide `classif` / `A/B/C` / `A=0` / `B=0` / `C=0` grep) returned **no** definition of it, so it **was not re-run**. The earlier `A/B/C = 0` result is therefore **superseded by the U/bare check** (the `UNVERIFIED`-marker / bare, command-less-claim audit whose labelling is applied in §7 below) and **was not re-confirmed**. The earlier invariant is **not** asserted to still hold.

---

## 1. Verification gates — run 2026-09-26 🔍 (this is the state of the *2026-09-26* tree; the current tree is §1.1)

| Gate | Command | Result |
|------|---------|--------|
| Backend typecheck | `npm run typecheck` | `TYPECHECK_EXIT=0` |
| Lint | `npm run lint` | `LINT_EXIT=0` |
| Web typecheck | `cd apps/web && npm run typecheck` | `WEBTSC_EXIT=0` |
| Backend tests | `npx jest --silent` | `Test Suites: 104 passed, 104 total` / `Tests: 1076 passed, 1076 total` / `Time: 223.703 s` / `JEST_EXIT=0` |
| Contracts typecheck | `cd packages/contracts && npx tsc --noEmit -p tsconfig.json` | `CONTRACTS_TSC_EXIT=0` |
| Fresh-DB migration replay | create `gym_p3_check_1790444978`, `DB_DATABASE=<temp> typeorm migration:run` | `45 migrations were found` / `45 migrations are new migrations must be executed` / 45 × `has been executed successfully` / `MIG_RUN_EXIT=0` |
| Migration state | `migration:show` on the same fresh DB | 45 entries all `[X]`, including `[X] 36 CreateMembershipDiscounts1788965263262` / `SHOW_EXIT=0` |

Cleanup: the temporary database was dropped and no `gym_p3_check*` database remains (`SELECT datname … LIKE 'gym_p3_check%'` → empty).

**Verified consequence:** the P3-04b migration `1788965263262-CreateMembershipDiscounts` **does** apply cleanly on a zero-state database alongside the other 44 migrations. Migration replay is no longer an open risk for Phase 3. *(Measured 2026-09-26, when `…262` was still uncommitted; it was committed 2026-09-28 in `021dc160`. The finding is unaffected by the commit.)*

### 1.1 Re-run after the DEF-01 fix — 2026-09-27 🔍

| Gate | Command | Result |
|------|---------|--------|
| Backend tests (full repo) | `npx jest` | `Test Suites: 106 passed, 106 total` / `Tests: 1109 passed, 1109 total` / `Snapshots: 0 total` / `Ran all test suites.` / `JEST_EXIT=0` |
| Backend typecheck | `npm run typecheck` (`tsc --noEmit -p tsconfig.spec.json`) | `TYPECHECK_EXIT=0` |
| Lint | `npm run lint` (`eslint . --ext .ts`) | `LINT_EXIT=0` |
| DEF-01 spec alone | `npx jest src/memberships/dto/query-membership-plan.dto.spec.ts --verbose` | 14/14 ✓ / `NEWSPEC_EXIT=0` |
| Memberships module | `npx jest src/memberships` | `Test Suites: 9 passed, 9 total` / `Tests: 136 passed, 136 total` / `TARGETED_EXIT=0` |

No suite was skipped or failed (the summary reports no `skipped`/`todo` and no `FAIL`). `Time` for the 2026-09-27 run was **975.338 s**, which is inflated — that invocation overlapped two other `jest` runs on the same machine — and is not a regression signal.

Two facts this re-run corrects in §1: the 2026-09-26 `104/1076` row is the **earlier tree**, not the current one, and the suite delta `104 → 106` is accounted for by the two new spec files (`query-membership-plan.dto.spec.ts` — **14** tests — and `create-membership-discount.dto.spec.ts` — **11** tests, each measured in isolation). The test delta (`1076 → 1109`, i.e. +33) is deliberately **not** decomposed: `memberships.service.spec.ts` (35 → 47 test declarations; uncommitted when measured 2026-09-27, committed 2026-09-28 in `021dc160`) and `memberships.controller.spec.ts` (also modified) changed in the same work, and 14 + 11 + 12 ≠ 33, so no per-file attribution is claimed here.

CI note: `.github/workflows/ci.yml` runs exactly `npm ci` → `npm run typecheck` → `npm run lint` → `cd apps/web && npm run typecheck` → `npx jest --passWithNoTests`. It does **not** build or typecheck `packages/contracts` (the root `tsconfig.json` excludes `packages`), which is why the contracts typecheck is reported separately above.

---

## 2. Repository, commit and push state 🔍

```
git --no-pager log -1 --format='%h %s'
  d6c26095 docs: formally defer RLS and record application-layer tenant isolation

git rev-parse HEAD origin/main
  d6c26095be8e43d149c5120529bb4a59b3d56124   <- HEAD
  b4b6464d2d1bc9795fcebcf036357943fa717d12   <- origin/main

git status -sb            -> ## main...origin/main [ahead 6]
git status --porcelain | wc -l -> 15
```

**Unpushed commits (6)** — independently confirmed against the live remote in this session. *(2026-09-26 reading; **8** as of 2026-09-28 after `e16c1118` and `021dc160`; **0** as of the `a5a32f77` baseline — all of them are on `origin/main` and `git rev-list origin/main..main --count` → `0`.)*

```
git ls-remote origin refs/heads/main
  b4b6464d2d1bc9795fcebcf036357943fa717d12   refs/heads/main      <- what the remote actually has
git rev-parse main
  d6c26095be8e43d149c5120529bb4a59b3d56124                        <- what is local

d6c26095 docs: formally defer RLS and record application-layer tenant isolation
3dee318a fix(memberships): stop @Type(() => Boolean) from inverting is_active=false (DEF-01)
e2d062c2 fix(pt): align PT_EVENT_VERSION with the platform 'v1' convention
332361d6 fix(pt): map the concurrent payout-run unique violation to a 409
fa8c5212 feat(pt): add PT commission payout runs with the paid transition
823c00d5 feat(pt): add PT enrollment cancellation with atomic commission clawback
```

So `origin/main` is **6 commits behind local `main`** — the PT clawback/payout work does not exist on the remote.
Migrations: 19 Phase-3 migrations (`…253`–`…271`) create **25 new tables** (`grep -h 'CREATE TABLE' … | sort -u`).

**Uncommitted working tree as of 2026-09-26 (15 entries — 8 modified tracked + 7 untracked; verbatim `git status --porcelain`):** *(down to 3 non-source paths by 2026-09-28 — see §0)*

```
 M docs/event-contracts.md
 M src/memberships/controllers/memberships.controller.spec.ts
 M src/memberships/controllers/memberships.controller.ts
 M src/memberships/memberships.module.ts
 M src/memberships/services/memberships.service.spec.ts
 M src/memberships/services/memberships.service.ts
 M src/shared/workers/membership-expiry.worker.spec.ts
 M src/shared/workers/membership-expiry.worker.ts
?? docs/phase3-completion-checklist-report.md
?? packages/contracts/src/events/crm.events.ts
?? packages/contracts/src/events/inventory.events.ts
?? src/memberships/dto/create-membership-discount.dto.spec.ts
?? src/memberships/dto/create-membership-discount.dto.ts
?? src/memberships/entities/membership-discount.entity.ts
?? src/migrations/1788965263262-CreateMembershipDiscounts.ts
```

Migrations on disk: **45**, all 45 tracked as of 2026-09-28 (`git ls-files` → 53 `.ts` under `src/migrations`, minus the 8 under `src/migrations/__specs__/`; `git ls-files --others` → 0). As measured on 2026-09-27 it was **44** tracked + the then-untracked `…262`, i.e. 52 tracked `.ts` in total (committed 2026-09-28 in `021dc160`).

Long-lived worktrees (verified with `git worktree list`): `main` @ `d6c26095`, `phase-4` @ `8ca91e4e` (`/home/cyberbeast/Projects/gym-saas-phase4`), `phase-6` @ `bbf73176` (`/home/cyberbeast/Projects/gym-saas-phase6`).

* `phase-4` @ `8ca91e4e` (`feat(observability): add Sentry error tracking + structured pino logging + CI`) **is an ancestor of `main`** (`git merge-base --is-ancestor phase-4 main` → true), so that branch tip is already in `main`'s history — no Phase-4 divergence to reconcile at that commit.
* `phase-6` @ `bbf73176` is **not** an ancestor: `git rev-list --count main..phase-6` → **82** commits unique to `phase-6`, and `git rev-list --count phase-6..main` → **8** commits unique to `main` (re-measured this session; this is the count whose reverse direction §8 states as the `82/8` divergence figure). That is a genuinely divergent branch.

So the Phase 6 integration cost is real but **unmeasured** (see §8.5).

---

## 3. Item-by-item checklist

Statuses are measured against **tracked content on `main`**: ✅ = the artifact is committed; 🟡 = implemented but uncommitted; 🚧 = partly implemented; ❌ = absent.

### 3.1 P3-01 — Financial Ledger Read Model — ✅

| Check | State |
|-------|-------|
| Ledger read service | ✅ `src/finance/services/ledger.service.ts` (+ `ledger.service.spec.ts`) |
| Ledger views migration | ✅ `1788965263253-CreateFinanceLedgerViews.ts` (+ `__specs__/1788965263253-CreateFinanceLedgerViews.spec.ts`) |
| `GET /v1/members/{id}/outstanding-balance` | ✅ `src/finance/controllers/member-outstanding-balance.controller.ts:31` |
| `GET /v1/financial-reports/revenue-summary` | ✅ `src/finance/controllers/financial-reports.controller.ts:26` |
| `GET /v1/financial-reports/outstanding-by-status` | ✅ `…:33` |
| Controller specs | ✅ `ledger.controller.spec.ts` |
| Plan deviation recorded | ✅ §1 supersedes the backlog's "materialized view for member outstanding balance" with a plain view; §15 Q4 ruled allocations out of scope |
| Two **reporting** objects are plain views, not the plan's `MV_*` | ⚠️ plan §1 (lines 70, 77–78) recommends *materialized* views for `MV_FINANCE_REVENUE_BY_PERIOD` / `MV_FINANCE_OUTSTANDING_BY_STATUS`; the code builds `V_FINANCE_REVENUE_BY_PERIOD` / `V_FINANCE_OUTSTANDING_BY_STATUS` as **plain** views (`ledger.constants.ts:34,36`; `ledger-views.constants.ts:228,330` → `CREATE OR REPLACE VIEW`). The change is **approved and recorded in code** — `…253-CreateFinanceLedgerViews.ts:23-25` ("§1's recommended default was materialized views for the two reporting objects. The approved decision is plain views for all three, so `MV_*` became `V_*`") and pinned by `__specs__/1788965263253-….spec.ts:79` — but **§15 Q1 has no `Decision` line**, so the approval is traceable only to the migration, not to the plan (§9.2) |

**Acceptance criteria (backlog):** balance = sum of unpaid invoices · revenue reports match paid invoices · reports generated quickly · data consistent with source of truth.
**Verdict:** artifacts present and covered by service/controller specs; the *behavioural* criteria were **not** re-exercised against a live API in this session — **UNVERIFIED (runtime)**.

### 3.2 P3-02 — Refunds & Credit Notes — ✅

| Check | State |
|-------|-------|
| Refund service + controller | ✅ `refunds.service.ts` (+ spec), `refunds.controller.ts` (`GET/POST /v1/refunds`, `GET /v1/refunds/:id`, `POST /v1/payments/:id/refunds`) |
| Credit-note service + controller | ✅ `credit-notes.service.ts` (+ spec), `credit-notes.controller.ts` (`GET /v1/credit-notes`, `GET /v1/credit-notes/:id`, `POST /v1/invoices/:id/credit-notes`) |
| Schema | ✅ `…258-CreateRefundAndCreditNoteTables.ts`; ledger views extended by `…259` |
| Permissions | ✅ `…257-ProvisionRefundAndCreditNotePermissions.ts` |
| Phase 1 escape hatches closed | ✅ `invoices.service.ts:594` now refuses to void a paid invoice and points the caller at a **refund** (P3-02), instead of the Phase-1 placeholder |
| Credit-note tax reversal ruling | ✅ §15 recorded (`b66eaebd`) |
| `refundedTotal` counts only succeeded refunds | ✅ pinned (`8140d64f`, `c7f84c08`) |
| Known limits recorded | ✅ `4abc14fb` records the credit-note/refund limits left open |
| Refund idempotency gap **closed** (plan §3 requires it of P3-03) | ✅ `create-refund.dto.ts:39` adds an optional `idempotency_key`; `refunds.service.ts:136,144,184,189` replay on it (`b4b6464d`) |
| Stale docblock contradicting that fix | ❌ `refunds.service.ts:62-70` still reads "*## Known gap: no idempotency key* … tracked … as work **P3-03** must close", while the method 74 lines below consumes a key and replays on the unique violation — the comment now misdescribes the service |
| Plan API surface | ⚠️ §2's table lists 4 endpoints; the implementation adds `GET /v1/refunds/:id` and `GET /v1/credit-notes/:id` (additive, unlisted in the backlog) |

**Verdict:** ✅ complete for the recorded scope. No open gap found in this pass.

### 3.3 P3-03 — Payment Gateway Integration — ✅ committed in `b4b6464d` (with two documentation gaps)

| Check | State |
|-------|-------|
| Gateway port + Stripe adapter | ✅ `payment-gateway.port.ts`, `stripe-payment-gateway.adapter.ts` (+ spec), `isConfigured` guard |
| Webhook ingestion | ✅ `gateway-webhook.service.ts`, `gateway-webhook.controller.ts` (`POST /v1/webhooks/payment-gateway`), `webhook-event.processor.ts` (+ spec) |
| Webhook idempotency storage | ✅ `webhook-event.entity.ts`; migration `…260-AddPaymentGatewayAndWebhookEvents.ts` |
| Saved payment methods | ✅ `payment-methods.service.ts` (+ spec), `payment-methods.controller.ts` (`POST /v1/members/:id/payment-methods`); migration `…261-CreateFinancePaymentMethods.ts`; `attach-payment-method.dto.ts` |
| Stripe optional-key boot safety | ✅ `gateway-webhook.service.ts:22` → `if (key) this.stripe = new Stripe(key);` |
| Module wiring (former BLOCKER-1) | ✅ `finance.module.ts` providers at lines 108–110, `exports:` block opens at line 122 and includes `WebhookEventProcessor` (line 133) |
| Boot regression pinned | ✅ `src/app.boot.spec.ts` compiles the real `AppModule` with `STRIPE_SECRET_KEY` unset and asserts the BLOCKER-1/BLOCKER-2 conditions |
| Payment-retry worker | ✅ `payment-retry.worker.ts` (+ `payment-retry.service.spec.ts`) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` documented | ✅ `287faeec` added both keys (`grep -in 'stripe' .env.example` → 6 lines) |
| `INVOICE_OVERDUE` / `DUNNING_ESCALATED` events mirrored | ✅ `finance.constants.ts:121-122` |

**Verdict:** ✅ functionally complete; the outstanding items are configuration discoverability (`.env.example`), not endpoint defects. The previously reported boot blockers are **fixed and pinned by a test** — that is a closed finding.

### 3.4 P3-04 — Tax Handling — ✅

| Check | State |
|-------|-------|
| Tax-rate schema | ✅ `…255-CreateFinanceTaxTables.ts`; `tax-rate.entity.ts`, `tax-line.entity.ts` |
| Tax-exemption columns | ✅ `…256-AddMemberTaxExemption.ts` (`tax_exempt`, `tax_exempt_reason`) |
| Centralised money/tax maths | ✅ `computeLineTax()`, `computeInvoiceTotals()`, `toMoney()`, `sumMoney()` in `finance.constants.ts` (+ spec) |
| Tax rates API | ✅ `GET /v1/tax-rates`, `GET /v1/tax-rates/:id`, `POST /v1/tax-rates`; `tax-rates.service.spec.ts`, `tax-rates.controller.spec.ts`, `query-tax-rate.dto.spec.ts` |
| `finance:admin` permission | ✅ `…254-ProvisionFinanceAdminPermission.ts` |
| Zero-rated audit row for exempt members | ✅ implemented per §15 **Q7** ruling (`Decision`, line 1059 — "a zero-rated `FINANCE_TAX_LINES` row is still written"); covered by service spec. §15 **Q6** is tax-*rate* granularity (its own `Decision` at line 1055) — a different question |
| Backwards compatibility (no `tax_code` → `tax_amount = 0.00`) | ✅ §15 Q9(c) — no `InvoiceCreated.v2`, `.v1` payload unchanged |
| Tax lines surfaced on the invoice read API | ✅ `invoices.service.ts` |

**Acceptance criteria (backlog):** rates from org configuration · exempt members charged no tax with an audit row · `FINANCE_TAX_LINES` reporting data available.
**Verdict:** ✅ complete. Discount ordering (the other half of the original P3-04) is tracked separately as P3-04b.

### 3.5 P3-04b — Membership Discounts — ✅ committed in `021dc160` (criterion ruled 2026-09-27; entity spec still outstanding)

Split out of P3-04 because the membership side was never built in Phase 1.

| Check | State |
|-------|-------|
| `MembershipDiscount` entity | ✅ `src/memberships/entities/membership-discount.entity.ts` (committed in `021dc160`) |
| Create DTO | ✅ `src/memberships/dto/create-membership-discount.dto.ts` (committed in `021dc160`) |
| Migration | ✅ `src/migrations/1788965263262-CreateMembershipDiscounts.ts` (committed in `021dc160`) — **applies cleanly on a fresh DB (verified §1)** |
| Service logic | ✅ `memberships.service.ts` (committed in `021dc160`) — org/ownership guard, `FOR UPDATE` lock before the duplicate check, membership-sale path applies the discount |
| Endpoint | ✅ `POST /v1/memberships/:id/discount` (`memberships.controller.ts:69`) (committed in `021dc160`) |
| Module wiring | ✅ `memberships.module.ts` (committed in `021dc160`) |
| Tests | ✅ (committed in `021dc160`) `memberships.service.spec.ts` gained discount cases (`:380` cross-org rejection, `:400` lock-before-check, `:419` >100 % guard, `:434` 100 % boundary, `:543` real sale path persisting discounted totals + snapshot). *(Citations corrected 2026-09-27: the previous `:332`/`:352`/`:464` pointed at this file's `findAll` pagination, `findOne` and `create` tests. This row's file is the membership suite only — the finance-side pair for the same feature sits on the **Finance half** row below and on **Discount ordering** above: `invoices.service.spec.ts:330` (tax computed on the discounted amount; ruled order) and `:352` (no-active-discount regression).)* |
| Finance half (already committed) | ✅ `…263-CreateInvoiceDiscountSnapshots.ts`, `invoice-discount.entity.ts`, `invoices.service.ts` discount application + snapshot persistence (17 `discount` references) |
| DTO specs | ✅ **4** exist — `src/memberships/dto/`: `create-membership.dto.spec.ts`, `create-membership-discount.dto.spec.ts` (committed in `021dc160`), `membership-plan-price.dto.spec.ts`, `query-membership-plan.dto.spec.ts` (added by the DEF-01 fix, §4.5) |
| Entity specs | ❌ none — `src/memberships/entities/` holds no `*.spec.ts` (`membership-discount.entity.ts` included), so the entity half of the P3-04b spec item still stands |
| **Discount ordering** | ✅ **Ruled 2026-09-27 (plan §15 Q9(a)): fixed discount-before-tax, not configurable.** That is what the code does — `grep` for any ordering/config surface still returns zero hits, and the hard-coded discount → tax order is now *by design* rather than a gap — and no ordering setting will be built (rationale: no known customer or jurisdiction requirement for the alternative ordering; revisit if one emerges). The ruled order is pinned by `invoices.service.spec.ts:330` |
| Backlog acceptance criterion | ✅ **Relaxed 2026-09-27** — `docs/task-backlog.md` P3-04b and plan §4 now read “discounts applied **before** tax”; the criterion is met as amended (the *criterion* was the artifact at fault, not the code) |

**Gap detail (corrected 2026-09-27):** `invoices.service.ts:537-542` computes `discountAmount` then `netAmount = price - discountAmount` and taxes the net. **That is now the ruled behaviour, not a gap:** the discount/tax-ordering question — `phase3-status-report.md` §6 **Q5**, equivalently plan §15 **Q9(a)** — was **ruled on 2026-09-27 as fixed discount-before-tax, not configurable**, so the acceptance criterion was the thing that was wrong and has been relaxed (plan §4, `docs/task-backlog.md` P3-04b). What genuinely remains on this task: the entity spec (§3.5 above) and the *unverified* discount removal/update path — the commit is done **(`021dc160`, 2026-09-28)** — no `DELETE`/`PATCH` discount route exists on `v1/memberships` (the controller exposes `POST :id/discount` only).

**Close-out actions:**
- [x] Rule on `phase3-status-report.md` §6 **Q5** / plan §15 **Q9(a)** — **ruled 2026-09-27: fixed discount-before-tax, not configurable.** The rationale lives in plan §15 Q9(a); `phase3-scoping-plan.md` §4, its risk paragraph (line 968), `docs/task-backlog.md` P3-04b and `phase3-status-report.md` §4/§6 were reconciled to match
- [x] Fixed-order branch taken — the backlog acceptance criterion was amended to “discounts applied **before** tax”; no ordering setting was added (the ruling is that none will be)
- [ ] Add `membership-discount.entity.spec.ts` / DTO-validation spec (repo convention: sibling `*.spec.ts` for entities and DTOs).
- [x] Commit the membership half together with the already-committed `…263` snapshot table as one coherent P3-04b change. — **done 2026-09-28: committed as `021dc160`** (both halves landed together, as intended)

### 3.6 P3-05 — Inventory Management — ✅ committed in `b4b6464d`; ⚠️ (4 endpoints + 2 workers still absent)

| Check | State |
|-------|-------|
| Entities (6) | ✅ `inventory-item`, `inventory-lot`, `inventory-transaction`, `inventory-supplier`, `inventory-purchase-order`, `inventory-purchase-order-item` |
| Schema migration | ✅ `…264-CreateInventorySchema.ts` |
| Permissions migration | ✅ `…265-ProvisionInventoryPermissions.ts` |
| Service + controller | ✅ `inventory.service.ts`, `inventory.controller.ts` (both with specs) |
| Events | ✅ `INVENTORY_EVENT_TYPES` = `InventoryItemCreated`, `InventoryStockUpdated`, `InventoryItemSold`, `PurchaseOrderReceived`; `INVENTORY_EVENT_VERSION = 'v1'`; mirrored in `packages/contracts/src/events/inventory.events.ts` (tracked — committed in `08978034`) |
| Outbox discipline | ✅ events saved through `OutboxService.saveEventEnvelope(..., manager)` inside the transaction |
| FIFO costing (weighs in on §15 **Q19**) | ✅ `consumeFifo()` + lot rows locked `FOR UPDATE`, ordered `received_at ASC, id ASC`; `inventory-lot.entity.ts` carries `unit_cost`, `quantity`, `expiry_date` → **option (a) FIFO was chosen in code** |
| Per-branch stock (weighs in on §15 **Q21**) | ✅ `inventory-item.entity.ts:4,8` → unique `(organization_id, branch_id, sku)` + `branch_id` column → **per-branch stock was chosen in code** |
| Backlog endpoints `GET /v1/inventory/items/{id}` | ❌ absent |
| Backlog endpoint `PATCH /v1/inventory/items/{id}` | ❌ absent |
| Backlog endpoint `GET /v1/inventory/lots` | ❌ absent |
| Backlog endpoint `GET /v1/inventory/purchase-orders/{id}` | ❌ absent |
| Extra endpoints beyond the backlog | ✅ `GET /v1/inventory/stock`, `POST /v1/inventory/transactions/consume` |
| Low-stock / reorder worker | ❌ `src/shared/workers/` has no inventory worker and `workers.module.ts` registers none |
| Lot-expiry worker | ❌ same |
| Entity/DTO/constants specs | ❌ only `inventory.service.spec.ts` + `inventory.controller.spec.ts` (2 specs for the whole module) |
| §15 Q19/Q21 rulings recorded in `docs/` | ❌ the decisions exist only in code — the plan's §15 still lists both as open |

**Verdict:** the stock-movement core (receive → lot → FIFO consume → transaction → event) is committed and tested, but the module cannot be called "P3-05 complete": four backlog endpoints and two backlog workers are missing, and two plan questions were answered silently in code.

**Close-out actions:**
- [ ] Add the four missing read/update endpoints (or record their removal with a ruling).
- [ ] Build the reorder-level and lot-expiry workers, or descope them in writing.
- [ ] Record the Q19 (FIFO) and Q21 (per-branch) outcomes back into §15 so plan and code agree.

### 3.7 P3-06 — CRM Lead Management — ✅ committed in `b4b6464d` (with a backlog-documentation defect)

| Check | State |
|-------|-------|
| Entity + schema migration | ✅ `…266-CreateCrmLeadManagement.ts` |
| Permissions migration | ✅ `…267-ProvisionCrmPermissions.ts`, consumed from `crm.constants.ts:24-26` |
| Service + controller | ✅ `crm.service.ts` (+ spec), `crm.controller.ts` (+ spec) |
| Routes | ✅ `GET /v1/leads`, `GET /v1/leads/pipeline`, `GET /v1/leads/:id`, `POST /v1/leads`, `PATCH /v1/leads/:id`, `POST /v1/leads/:id/activities`, `POST /v1/leads/:id/convert`, `POST /v1/leads/:id/follow-ups` |
| Events | ✅ `LeadCreated`, `LeadContacted`, `LeadQualified`, `MemberConverted`, `LeadLost`; `CRM_EVENT_VERSION = 'v1'`; mirrored in `packages/contracts/src/events/crm.events.ts` (tracked — committed in `08978034`) |
| §15 Q22 (member auto-creation on conversion) | ⚠️ `POST :id/convert` ships, but §15 Q22 (a) create-member-immediately / (b) prospect / (c) member-without-plan is still unruled, and plan line 962 warns the missing-trial-plan path must be a validation error, not a 500 — whether that is satisfied is **UNVERIFIED** |
| Backlog entry integrity | ❌ `docs/task-backlog.md` P3-06 (line 460) is truncated: it stops at "Files/modules affected" and has **no** acceptance criteria, tests, or risks — a backlog defect, not a code defect |

**Verdict:** ✅ implemented and tested. Only the backlog text and the Q22 paper trail are outstanding.

### 3.8 P3-07 — Follow-ups & SLAs — ✅ committed in `b4b6464d`

| Check | State |
|-------|-------|
| Entity + schema migration | ✅ `…268-CreateCrmFollowUpsAndSla.ts` → `CRM_SLA_POLICIES`, `CRM_FOLLOW_UPS`, `CRM_SLA_BREACHES` |
| Services | ✅ `follow-ups.service.ts` (+ spec), `sla.service.ts` (+ spec) |
| Controllers | ✅ `follow-ups.controller.ts` (`GET /v1/follow-ups/due`, `POST /v1/follow-ups/:id/complete`) + spec; `sla.controller.ts` (`GET /v1/sla/reports`, `GET /v1/sla/policies`, `POST /v1/sla/policies`, `PATCH /v1/sla/policies/:id`) + spec |
| Events | ✅ `FollowUpScheduled`, `FollowUpCompleted`, `SlaBreached`, `SlaEscalated` |
| Workers | ✅ `CrmFollowUpsWorker` + `CrmSlaMonitorWorker` registered and exported in `workers.module.ts` |
| Constants spec | ✅ `crm.constants.spec.ts` |
| `CRM_NURTURING` worker (plan §5) | ❌ not built; not registered anywhere |

**Verdict:** ✅ for everything the backlog lists (schedule follow-ups, due queue, complete, SLA policies and reports). The `CRM_NURTURING` worker is a **plan-level** expectation that was never built — see the worker table in §5.

### 3.9 P3-08 — Dunning — ✅ committed in `b4b6464d` (implementation), ⚠️ (semantics unruled)

| Check | State |
|-------|-------|
| Entity + schema migration | ✅ `dunning-attempt.entity.ts`; `…269-CreateFinanceDunningAttempts.ts` |
| Service | ✅ `dunning.service.ts` (+ `dunning.service.spec.ts`) |
| Worker | ✅ `dunning.worker.ts`, registered and exported in `workers.module.ts` |
| Events | ✅ `INVOICE_OVERDUE: 'InvoiceOverdue'`, `DUNNING_ESCALATED: 'DunningEscalated'` (`finance.constants.ts:121-122`); documented in the `docs/event-contracts.md` diff (committed in `08978034`) |
| Interaction with payment retries | ⚠️ `payment-retry.service.ts` (+ spec) exists separately; the retry-vs-escalate boundary depends on the unruled dunning semantics |
| Backlog entry | ❌ **no `P3-08` item exists in `docs/task-backlog.md` at all** (see §5) |

**Verdict:** the code is complete and tested; what remains are the open §15 dunning semantic questions, not missing functionality.

---

## 4. Items continued — P3-09 → DEF-01

### 4.1 P3-09 — Recurring Billing / Renewal — ✅ committed in `e16c1118` (still partial: no operator route)

| Check | State |
|-------|-------|
| Renewal logic | ✅ `memberships.service.ts` renewal path (committed in `e16c1118`) — a failed charge must not extend or expire the membership (`memberships.service.spec.ts:267` — re-pointed 2026-09-27 from `:262`) |
| Scheduled renewal | ✅ `membership-expiry.worker.ts` (committed in `e16c1118`, + spec) drives due-member renewal |
| Off-session payment capability | ✅ `…261-CreateFinancePaymentMethods.ts` (committed) |
| Operator-facing renewal route | ❌ **no `POST /v1/memberships/:id/renew`** — the controller exposes only `GET`, `GET /member/:memberId`, `GET :id`, `POST`, `PATCH :id`, `POST :id/discount`, `POST :id/pause`, `POST :id/resume`, `POST :id/freeze`, `POST :id/unfreeze`, `POST :id/cancel` |
| Dedicated renewal worker key | ❌ absent from `worker-config.ts` (`WORKER_INTERVALS` / `WORKER_BATCH_SIZES` have no renewal entry); renewal rides the expiry worker's schedule |
| Backlog entry | ❌ **no `P3-09` item exists in `docs/task-backlog.md`** |

**Close-out actions:**
- [ ] Rule on `phase3-status-report.md` §6 **Q8** (operator-initiated renewal route — *not* plan §15 Q8, which is discount ownership): add the route, or record that renewal is worker-only.
- [x] Commit the renewal half of the uncommitted membership change. — **done 2026-09-28: committed as `e16c1118`**
- [ ] Create the missing backlog entry (`P3-09`) describing what was actually built.

### 4.2 P3-10 — Object Storage Configuration — ❌

| Check | State |
|-------|-------|
| `S3Service` exists and works locally | ✅ `src/shared/storage/s3.service.ts` — local-disk fallback via `S3_LOCAL_ROOT` (line 33), bucket `S3_DOCUMENTS_BUCKET` (line 46), region `AWS_REGION` (line 48) |
| Module importable without wiring S3 into every consumer | ❌ `s3.module.ts` has **no `@Global()`**; consumers must import it explicitly |
| Non-member key builders | ⚠️ plan §10 **recommendation 1** is to *add* `buildCrmAttachmentKey()` / `buildInventoryImageKey()` and **not** to generalise `buildKey()` (changing its 4-argument signature would break the Phase 2 document specs). Neither builder exists, but §10's scope note explicitly allows deferral until a CRM/Inventory consumer needs one |
| Env documented | ❌ **`.env.example` contains zero `S3_*`, `AWS_*`, or bucket entries** (`grep -in 's3' .env.example` → no matches) |
| Backlog entry | ❌ **no `P3-10` item exists in `docs/task-backlog.md`** |

**Verdict:** ❌ not started as a deliverable. The service works; the configuration surface (global module, non-member key prefixes, documented env) does not exist. This is the cheapest unblocked item in the phase.

### 4.3 P3-11 — PT Commission Clawback — ✅ committed in `823c00d5`

| Check | State |
|-------|-------|
| Atomic clawback on enrollment cancel | ✅ `pt-enrollments.service.ts`, `pt-enrollments.controller.ts` (`POST /v1/pt/enrollments/:id/cancel`) + both specs — commit `823c00d5` |
| `CLAWED_BACK` commission status | ✅ present in the PT constants/service |
| Events | ✅ `TrainerCommissionClawedBack.v1`, `TrainerCommissionPaid.v1`; `PT_EVENT_VERSION = 'v1'` (commit `e2d062c2` corrected an earlier version drift) |
| Outbox/transaction discipline | ✅ clawback and its outbox row are written in one transaction |
| Pushed to origin | ✅ `823c00d5` and the two PT follow-ups are on `origin/main` — **0 unpushed** at the `a5a32f77` baseline (§2) |

### 4.4 P3-12 — Payout Batching — ✅ committed in `fa8c5212`

| Check | State |
|-------|-------|
| Schema | ✅ `…270-CreatePtCommissionPayoutTables.ts` (+ `__specs__/1788965263270-CreatePtCommissionPayoutTables.spec.ts`) |
| Permission | ✅ `…271-ProvisionPtPayoutPermission.ts` (+ spec) |
| Service + controller | ✅ `commission-payouts.service.ts` (+ spec), `commission-payouts.controller.ts` (+ spec): `POST /v1/pt/commission-payouts`, `POST /v1/pt/commission-payouts/:id/process`, `GET /v1/pt/commission-payouts/:id` |
| `paid` transition | ✅ commit `fa8c5212` |
| Concurrent payout-run race | ✅ commit `332361d6` maps the unique violation to **HTTP 409** |
| Pushed to origin | ✅ on `origin/main` — **0 unpushed** at the `a5a32f77` baseline (§2) |

### 4.5 DEF-01 — `is_active` boolean query coercion (memberships) — ✅ fixed in this session, commit `3dee318a` (was ❌ open)

Pre-fix state (verified 2026-09-26 — the file no longer looks like this; see the close-out bullets below):

```ts
// src/memberships/dto/query-membership-plan.dto.ts:17-20
  @IsOptional()
  @Type(() => Boolean)     // <-- the defect: Boolean('false') === true
  @IsBoolean()
  is_active?: boolean;
```

* `src/memberships/dto/` had **no** `query-membership-plan.dto.spec.ts` (one was added — see below).
  *(Corrected 2026-09-26: when this bullet was first written it also claimed the directory contained only `query-membership-plan.dto.ts`. That was wrong — the directory already held `create-membership.dto.spec.ts`, `create-membership-discount.dto.spec.ts` and `membership-plan-price.dto.spec.ts`.)*
* The correct pattern already exists in the repo and even named this defect: `src/finance/dto/query-tax-rate.dto.ts:8-15` **then** said `is_active` "is parsed with `@Transform` rather than the `@Type(() => Boolean)` that `QueryMembershipPlanDto` uses, because `Boolean('false')` is `true` … would silently filter for ACTIVE rates", and points to `QueryInvoiceDto.outstanding_only` as the established form. That sentence described *this* DTO in the present tense, so the fix made it false; the file has since been updated to record DEF-01 as historical (last close-out bullet below).

**Closed out in this session (no ruling needed — was fully unblocked):**
- [x] `query-membership-plan.dto.ts:34` now uses the proven transform `@Transform(({ value }) => value === true || value === 'true')`, with a docblock recording the trap. `ValidationPipe` runs with `transform: true` (`src/main.ts:15`), so this transform is what the endpoint applies.
- [x] Added `src/memberships/dto/query-membership-plan.dto.spec.ts` asserting `'true'` → `true`, `'false'` → `false`, `undefined` → `undefined`, plus `'0'`/`'1'`/`'FALSE'` → `false`, real booleans, page/limit coercion and `whitelist` stripping of an unknown `organization_id`.
- [x] `grep -rn '@Type(() => Boolean)' src/` now returns **no live coercion** — six comment/docblock mentions remain, **3 in memberships** (`query-membership-plan.dto.ts:9`, `query-membership-plan.dto.spec.ts:11,39` — added by this fix) and **3 in finance** (`query-tax-rate.dto.ts:8`, `query-tax-rate.dto.spec.ts:10,38`), so both DTOs and both specs record the trap. DEF-01 was the last **live-code** instance in the repository.
- [x] Verified this session: `npx jest src/memberships` → `Test Suites: 9 passed, 9 total`, `Tests: 136 passed, 136 total`, `TARGETED_EXIT=0`; `tsc --noEmit -p tsconfig.spec.json` → `TYPECHECK_EXIT=0`.
- [x] Re-ran every repo-wide gate against the fixed tree: `npx jest` → `Test Suites: 106 passed, 106 total` / `Tests: 1109 passed, 1109 total` / `JEST_EXIT=0`; `npm run typecheck` → `TYPECHECK_EXIT=0`; `npm run lint` → `LINT_EXIT=0`; the new spec alone → 14/14 ✓ / `NEWSPEC_EXIT=0` (§1.1).
- [x] Also corrected the sentence in `src/finance/dto/query-tax-rate.dto.ts:8-15` that *named* this defect: it described `QueryMembershipPlanDto` in the present tense ("the `@Type(() => Boolean)` that `QueryMembershipPlanDto` uses"), which this fix made false. It now records DEF-01 as historical. **Comment-only change — no code in that file was touched** (the diff is confined to the docblock).

---

## 5. Cross-cutting requirements (§12.3 and plan-wide)

### 5.1 Tenant isolation 🔍

| Check | Evidence | State |
|-------|----------|-------|
| Never trust a client-supplied org id | `src/inventory/dto`, `src/crm/dto`, `src/finance/dto`, `src/pt/dto` contain **zero** `organization_id`/`organizationId` properties; the only hits are in `query-tax-rate.dto.spec.ts:82-86`, which asserts an injected `organization_id: 'attacker-org'` is **stripped** | ✅ |
| Org predicates on new queries | renewal locks with `{ id, organization_id }` + `pessimistic_write`; inventory consume locks lots with `lot.organization_id = :org`; renewal invoice lookup filters `invoice.organization_id` **and** `item.organization_id` | ✅ |
| Cross-org rejection tests | `memberships.service.spec.ts:380` *(re-pointed 2026-09-27 from `:332` — same stale trio as §3.5)* ("rejects a membership from another organization before creating a discount") | ✅ |
| **RLS** (Q11 in `phase3-status-report.md` §6 — *not* plan §15 Q11, which is gateway selection) | `grep -rin 'row level security\|CREATE POLICY\|ENABLE ROW LEVEL' src/` → **0 hits** | ✅ **Closed by ruling 2026-09-26: RLS formally deferred**; application-layer scoping is the accepted permanent mechanism (`docs/database-plan.md`). Not implemented, and no longer expected to be |

### 5.2 §12.3 documentation and permission prerequisites

| §12.3 item | State | Evidence |
|------------|-------|----------|
| Permission migrations (`inventory:*`, `crm:*`, `finance:refund`, `finance:credit-note`, `finance:admin`, `pt:payout`) | ✅ | `…254`, `…257`, `…265`, `…267`, `…271` (+ the three `__specs__` permission specs) |
| Doc 1 — `docs/event-contracts.md` | ✅ | Committed in **`08978034`** as a **+56/−0** diff adding `### Inventory Events` and `### CRM Events`. `InvoiceOverdue`, `DunningEscalated`, `InventoryItemCreated`, `PurchaseOrderReceived`, `LeadCreated`, `SlaBreached`, `TrainerCommissionClawedBack`, `TrainerCommissionPaid` are each documented once. **`MembershipDiscountApplied` is absent** — and no such event exists in code (P3-04b emits none) |
| Doc 2 — `docs/database-plan.md` | ✅ | Present: `FINANCE_TAX_RATES`, `FINANCE_TAX_LINES`, `FINANCE_REFUNDS`, `FINANCE_CREDIT_NOTES`, `INVENTORY_INVENTORY_ITEMS`, `INVENTORY_INVENTORY_LOTS`, `INVENTORY_PURCHASE_ORDERS`, `CRM_LEADS`, `CRM_FOLLOW_UPS`, `MEMBERSHIP_MEMBERSHIP_DISCOUNTS`. The six previously-missing real tables — `FINANCE_WEBHOOK_EVENTS`, `FINANCE_PAYMENT_METHODS`, `FINANCE_DUNNING_ATTEMPTS`, `FINANCE_INVOICE_DISCOUNTS`, `CRM_SLA_POLICIES`, `CRM_SLA_BREACHES` — are now present (committed in `3090573b`); the actual payout tables are `PT_COMMISSION_PAYOUT_RUNS` / `PT_COMMISSION_PAYOUT_ITEMS` (added in `33a14f3a`), not the phantom `PT_COMMISSION_PAYOUTS` this row listed |
| Doc 3 — `packages/contracts/src/events/` | ✅ | `inventory.events.ts` and `crm.events.ts` exist **and are tracked** (committed in **`08978034`**); they typecheck (`CONTRACTS_TSC_EXIT=0`). **Corrected 2026-09-29:** the CI gates *do* cover this path — `npm run typecheck` runs `tsc --noEmit -p tsconfig.spec.json`, whose `include` is `["src/**/*", "packages/contracts/src/**/*"]`, and the eslint override matches `packages/**/*.ts`. Only jest does not: no spec file exists under `packages/`, so `npx jest`'s 106 suites are all under `src/` |
| Doc 4 — `docs/task-backlog.md` | 🟡 | ✅ the four false "completed in P1" annotations are gone (`grep 'completed in P1'` → 0 hits); ❌ recurring billing **and** dunning still have **no** backlog item (`grep -c '^### P3-'` → 8: P3-01, 02, 05, 06, 07, 03, 04, 04b); ❌ P3-03/P3-04 still appear *after* P3-07; ❌ P3-02 (line 412) and P3-06 (line 460) bodies are **truncated** — P3-02 stops at "API changes: POST /v1/payments/{id}/refunds (enhanced)", P3-06 stops at "Files/modules affected", so neither carries acceptance criteria |

### 5.3 Event mirroring (three places) 🔍

| Module | Backend constants | `docs/event-contracts.md` | `packages/contracts` |
|--------|-------------------|---------------------------|----------------------|
| Inventory | ✅ `inventory.constants.ts` (4 events) | ✅ committed in `08978034` | ✅ `inventory.events.ts` — tracked (committed in `08978034`) |
| CRM | ✅ `crm.constants.ts` (9 events) | ✅ committed in `08978034` | ✅ `crm.events.ts` — tracked (committed in `08978034`) |
| Finance | ✅ `finance.constants.ts:121-122` (+ Phase-1 events) | ✅ committed in `08978034` | ✅ committed |
| PT | ✅ `pt.constants.ts` (`*.v1` names) | ✅ | ✅ `pt.events.ts` |

### 5.4 Background workers 🔍

Registered in `workers.module.ts` (7): `OutboxWorker`, `MembershipExpiryWorker`, `PaymentRetryWorker`, `WebhookEventWorker`, `CrmFollowUpsWorker`, `CrmSlaMonitorWorker`, `DunningWorker` — plus `LoyaltyExpiryWorker` under `src/loyalty/workers/`. Keys in `worker-config.ts`: `OUTBOX`, `MEMBERSHIP_EXPIRY`, `PAYMENT_RETRY`, `DUNNING`, `WEBHOOK`, `EXPIRY`, `CRM_FOLLOW_UPS`, `CRM_SLA_MONITOR`.

| Plan §5 expectation | State |
|---------------------|-------|
| Dunning worker | ✅ |
| Recurring billing worker | 🟡 renewal folded into `MembershipExpiryWorker`; no `MEMBERSHIP_RENEWAL` key — defensible, but unrecorded |
| CRM nurturing worker (`CRM_NURTURING`, plan line 699) | ❌ not built |
| CRM follow-ups + SLA monitor | ✅ |
| Inventory low-stock/reorder + lot-expiry workers | ❌ not built (no key, no class) |

### 5.5 Test coverage shape 🔍

| Module | Specs |
|--------|-------|
| `finance` | 20 (services, controllers, constants, DTO, module) |
| `pt` | 8 |
| `crm` | 7 |
| `memberships` | 9 (`npx jest src/memberships` → `Test Suites: 9 passed, 9 total`, §1.1) |
| `loyalty` | 3 |
| `inventory` | **2** (`inventory.service.spec.ts`, `inventory.controller.spec.ts` only — no entity/DTO/constants/module specs) |
| Migrations | 7 item specs + `migration-loader.contract.spec.ts` |
| App boot | `src/app.boot.spec.ts` (real-DI compile with Stripe unset) |

### 5.6 Frontend 🔍

`grep -rniE 'inventory|leads|tax-rate|dunning|commission-payout' apps/web/src` → **0 hits**. Consistent with every Phase 3 backlog item stating "Frontend changes: None" (Phase 3 is API-only), so *on the backlog's reading* this is **not a gap**. *(Scope caveat added 2026-09-28: `implementation-roadmap.md` §Phase 3 "Frontend Changes" does list **five** deliverables — inventory management UI, CRM pipeline and lead management, advanced financial reports, trainer commission statements, refund and credit-note processing UI — and none of them exists. "API-only" is therefore the **backlog's** scope, not the **roadmap's**; the shortfall is unbacklogged, not non-existent. Enumerated in §7 under the "Frontend (`apps/web`) — outstanding" block.)*

### 5.7 P3-09 renewal event — RESOLVED ✅ (`MembershipRenewed.v1` is emitted)

* `renew()` (`memberships.service.ts:358`) and `renewDueMemberships()` (`:368`) exist, are tenant-scoped, and are idempotent (`membership-renewal:{membershipId}:{renewalDate}`, line 420). *(Citations re-pointed 2026-09-27: the previous `:334`/`:350`/`line 402` pre-dated the P3-04b discount lookup added to `renewOne` and no longer resolved to those statements.)*
* On a successful charge the path extends `end_date`/`renewal_date` (`:525-528`) and writes a `MembershipHistory` row with `transition: 'renew'` (`:530-539`). *(Citation corrected 2026-09-27: `:481-490` pre-dated the P3-04b discount lookup.)*
* **Emitted — resolved 2026-09-27.** The renewal path publishes `MembershipRenewed.v1` from inside its extending transaction (`memberships.service.ts:556-572`): on the caller's `manager`, so the event and the date extension commit or roll back together, and inside the `membership.renewal_date === created.membership.renewal_date` idempotency guard, so one payment cannot publish it twice. The payload matches `MembershipRenewedPayload` field-for-field (`packages/contracts/src/events/membership.events.ts:17-22`, declared there since before Phase 3): `membershipId`, `renewalDate` (the cycle that was settled), `nextPaymentDate` (the advanced end/renewal date) and `renewalFee` (what was charged — post-discount, because the renewal payment's amount comes from `invoice.total_amount`). The file's outbox writes are therefore **four**, not three: `MembershipRenewed` (`:556`), `MembershipExpired` (`:644`), `MembershipStarted` (`:735`) and the lifecycle-transition event (`:854`). *(Corrected 2026-09-27: this line previously read "**the renewal path emits nothing at all**. `MembershipRenewed` is never emitted" and cited `:562`/`:636`/`:747` — those numbers pre-dated both the renewal emission and the P3-04b discount lookup, and `:562` did not resolve to `MembershipExpired`. The emission is committed in `e16c1118` as of 2026-09-28.)*
* **Plan-conformance note, kept for the record:** plan §5 line 448 states "Reuse of the existing `MembershipExpired.v1` for the renewal case avoids one new event". The implementation publishes `MembershipRenewed.v1` instead, because `MembershipExpiredPayload` describes the **terminal** `expired` state ("transitioned to the terminal `expired` state", `membership.events.ts:46-47`) — the exact state the renewal branch avoids by extending the membership, so emitting it would assert something false. Both names pre-date Phase 3, so either way no net-new contract is created and no contract or `event-contracts.md` amendment is needed.
* [x] **RESOLVED 2026-09-27, committed 2026-09-28 in `e16c1118`:** renewal emits `MembershipRenewed.v1` inside the same TypeORM transaction as the date extension (`memberships.service.ts:556-572`). No contract or doc amendment was required — `MembershipRenewedPayload` (`membership.events.ts:17-22`) and `docs/event-contracts.md:44` already declared the event and its payload. Both paths are pinned by tests: published with the documented payload (`memberships.service.spec.ts:341`), and **not** published when the charge fails (`:323-330`).

---

## 6. Open rulings that block sign-off

`docs/phase3-status-report.md` §6 holds **11** rows (`Q1`–`Q11`). Their status after this session's evidence:

| # | Question (as written in §6) | Status now |
|---|-----------------------------|------------|
| Q1 | Is `HEAD` the deliverable baseline, or must the uncommitted files be committed? | **CLOSED 2026-09-28** — the feature files were committed (`b4b6464d`, `823c00d5`, `fa8c5212`, `e16c1118`, `021dc160`); the last **7** paths (3 contract/doc artifacts plus the 4 Phase-3 doc paths, none of them application source) also landed — the artifacts in `08978034`, this report and the Phase-3 docs in `bd19fca7` — so **0** paths are uncommitted at the `a5a32f77` baseline. `HEAD` is the deliverable baseline. *(Dated: this row read "Still open — 15 uncommitted paths remain (§2)" until the `e16c1118`/`021dc160` commits.)* |
| Q2 | If committed, is the P3-03 boot blocker fixed first? | **Moot** — `finance.module.ts` exports the three providers and `src/app.boot.spec.ts` compiles the real `AppModule` with Stripe unset (§3.3) |
| Q3 | Document `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` in `.env.example`? | ✅ **Done** — `287faeec` documented both keys (§3.3) |
| Q4 | Should `GatewayWebhookService` adopt the `isConfigured` guard? | **Moot** — `gateway-webhook.service.ts:22` already does `if (key) this.stripe = new Stripe(key)` (§3.3) |
| Q5 | Discount-before-tax permanently correct, or configurable ordering still required? | ✅ **RULED 2026-09-27** — permanent: discount-before-tax **by design**, configurable ordering will not be built (no known customer/jurisdiction requirement for the alternative; revisit if one emerges). The criterion was relaxed to match in plan §4 and `docs/task-backlog.md` P3-04b; **no code change** — the implementation already matches and `invoices.service.spec.ts:330` pins it (§3.5). No longer blocking |
| Q6 | All-or-nothing clawback (Q16) or pro-rata? | **Open** — implementation is committed; the ruling is a paper exercise unless pro-rata is chosen |
| Q7 | Is `PT_EVENT_VERSION = 'v1'` intentional or incidental? | **Answered by commit `e2d062c2`** ("align PT_EVENT_VERSION with the platform 'v1' convention") — **recorded in `73f6aa36`** (`phase3-status-report.md` §6 Q7 now quotes the rationale) |
| Q8 | Operator-triggered renewal route required? | **Open, and blocking** — `renew()` exists only at service/worker level (§4.1) |
| Q9 | Dunning schedule/counter-owner ruling (Q14 a/b) | **Open** — code is complete; semantics unruled (§3.9) |
| Q10 | Does the P3-10 S3 gap now need priority? | **Open** — the premise has changed (P3-05/P3-06 introduce non-member attachments); nothing implemented yet (§4.2) |
| Q11 | RLS: implement, or amend the plan to accept app-level scoping permanently? | ✅ **RULED 2026-09-26 — RLS formally deferred**; `database-plan.md` amended (mandate → "Tenant Isolation — Application-Layer Enforcement (RLS Deferred)"), backlog/roadmap/domain-map/completion-summary reconciled. This item no longer blocks sign-off |

Two further decisions are needed but are **not** in that §6 list:

| Topic | Source | Blocks |
|-------|--------|--------|
| **Q22** — member auto-creation on lead conversion: (a) create the member immediately, (b) create a prospect for later promotion, (c) create the member but defer plan assignment. Related: the backlog expects "trial memberships created" on conversion and plan line 962 warns that a missing trial plan must produce a validation error, not a 500. | plan §15 Q22 + §14.5 | The paper trail for P3-06's already-shipped `POST /v1/leads/:id/convert` (§3.7) |
| Workers: build `CRM_NURTURING` (plan line 699) and the inventory reorder / lot-expiry workers, or formally descope them | plan §5 | Phase-scope honesty (§5.4) |
| **Resolved 2026-09-27** — `MembershipRenewed.v1` **is emitted** from the renewal transaction (`memberships.service.ts:556-572`, payload matches the contract field-for-field); the contract and `docs/event-contracts.md:44` already declared it, so there was nothing to amend (committed in `e16c1118`, 2026-09-28) | §5.7 (was: new finding) | P3-09 |

---

## 7. Master completion checklist

**Gates**
- [x] Backend typecheck green (`TYPECHECK_EXIT=0`)
- [x] Lint green (`LINT_EXIT=0`)
- [x] Web typecheck green (`WEBTSC_EXIT=0`)
- [ ] Frontend lint green — **not run**: `.github/workflows/ci.yml:56-59` deliberately omits `cd apps/web && npm run lint` (tracked as ESLINT-002), so unlike the backend there is no `LINT_EXIT` for `apps/web`
- [x] 106/106 suites, 1109/1109 tests green (re-run 2026-09-27 after the DEF-01 fix — §1.1; the 104/1076 run recorded in §1 was the 2026-09-26 state)
- [x] `packages/contracts` typechecks (CI does not check it — see §1)
- [x] 45/45 migrations apply on a fresh database, including `…262` (untracked when the run was made; committed 2026-09-28 in `021dc160`), then the temp DB was dropped

**Code — done**
- [x] P3-01 ledger read model (views + 3 endpoints)
- [x] P3-02 refunds and credit notes
- [x] P3-03 gateway, webhooks, saved payment methods, retry worker, boot-safety test
- [x] P3-04 tax rates, exemptions, zero-rated audit rows
- [x] P3-05 inventory core (receive → FIFO → consume → outbox)
- [x] P3-06 CRM leads (incl. pipeline + convert)
- [x] P3-07 follow-ups + SLA (+ 2 workers)
- [x] P3-08 dunning (+ worker + entity)
- [x] P3-11 PT clawback
- [x] P3-12 PT payout runs (+ 409 on race)
- [x] All §12.3 permission migrations

**Code — outstanding**
- [x] P3-04b: commit the membership discount half (entity, DTO, migration `…262`, service, route, module) with `…263` — **done 2026-09-28: `021dc160`**
- [x] P3-04b: acceptance criterion **amended 2026-09-27** (ruled fixed discount-before-tax — plan §15 Q9(a); backlog P3-04b + plan §4 relaxed to match, no config surface added or planned)
- [ ] P3-04b: add entity specs
- [ ] P3-05: add `GET items/:id`, `PATCH items/:id`, `GET lots`, `GET purchase-orders/:id`
- [ ] P3-05: build or descope the reorder and lot-expiry workers
- [ ] P3-05: record Q19 (FIFO) and Q21 (per-branch) decisions in §15
- [x] P3-09: commit the renewal half — **done 2026-09-28: committed as `e16c1118`**
- [ ] P3-09: add the operator route (`phase3-status-report.md` §6 Q8) or record worker-only renewal — **still open** (all membership controllers contain 0 `renew` occurrences; renewal is service/worker-only)
- [x] P3-09: renewal event **emitted** — `MembershipRenewed.v1` from the extending transaction (`memberships.service.ts:556-572`), payload matching `MembershipRenewedPayload` field-for-field; tests `memberships.service.spec.ts:341` (published with the documented payload) and `:323-330` (failed charge publishes nothing). Deliberately *not* plan §5's `MembershipExpired.v1`, which describes the terminal expired state. *(Committed 2026-09-28 in `e16c1118` — this line read "Uncommitted — pending commit" when written.)*
- [ ] P3-10: `@Global()` on `S3Module`; add `buildCrmAttachmentKey()` / `buildInventoryImageKey()` (plan §10 rec 1 — *not* a `buildKey()` signature change); document `S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET`, `AWS_REGION`
- [x] DEF-01: `@Transform` in `QueryMembershipPlanDto` + `query-membership-plan.dto.spec.ts` (fixed this session in commit `3dee318a` — see §4.5)
- [ ] P3-03: document `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` in `.env.example`
- [ ] Worker gaps (`CRM_NURTURING`, inventory reorder/lot-expiry): build or descope

**Frontend (`apps/web`) — done — static-verified (code and git inspection; not exercised in a browser)** *(inventoried 2026-09-28; last touched by `a79f34be` on 2026-09-15 — no `apps/web` path is modified in the current worktree. The **seven** items below were previously labelled "command-verified"; that label is **withdrawn** — each is a **static** result from reading the code and `git ls-files`, not from running the app. Runtime/browser behaviour stays **UNVERIFIED** — see §8.1–§8.2.)*
- [x] Next.js 15 App Router app, TypeScript + Tabler UI + `@tanstack/react-query`; **70** files tracked in git (`git ls-files apps/web | wc -l`)
- [x] **19** routes (`find apps/web/src/app -name page.tsx | wc -l` → 19): `/` · `/dashboard` · `/members` · `/memberships` · `/memberships/[id]` · `/membership-plans` · `/membership-plans/[id]` · `/payments` · `/check-in` · `/branches` · `/organizations` · `/settings` · `/ai-usage` · `/retention-analysis` · `/plan-performance` · `/login` · `/register` · `/forgot-password` · `/mfa-challenge`. Every nav `href` in `components/layout/Sidebar.tsx` resolves to one of these — the only `href="#"` is the user-menu dropdown toggle, so there are no dead nav items
- [x] Shell and layout: `layout.tsx`, `providers.tsx`, `globals.css`, `not-found.tsx`; `AppLayout`, `AuthLayout`, `Navbar`, `Sidebar`, `Footer`, `PageHeader`
- [x] Auth surface: `LoginForm`, `RegisterForm`, `MfaForm`, `AuthGuard`. Protection is **client-side only** — no `middleware.ts` exists anywhere under `apps/web`
- [x] Data layer obeys the repo rule that components never fetch: `fetch(` occurs **0** times under `apps/web/src/app` and `apps/web/src/components`, and only in `lib/api.ts`, which the 8 client modules (`auth`, `members`, `tenancy`, `memberships`, `attendance`, `finance`, `ai`, plus `jwt`/`token-store`/`types`/`api`) and `lib/hooks.ts` (766 lines of React Query hooks, query-key invalidation per mutation) wrap
- [x] UI primitives: `Alert`, `Badge`, `Button`, `Card`, `Empty`, `Modal`, `Pagination`, `Table`; plus 8 AI components under `components/ai/`
- [x] Build wiring: `next.config.js` (`output: 'standalone'`), `apps/web/.env.example` (`NEXT_PUBLIC_API_URL`), its own `tsconfig.json`, and a CI step at `ci.yml:47-48` (`cd apps/web && npm run typecheck`)

**Frontend (`apps/web`) — outstanding**
- [ ] **Phase 3 UI: none of the five `implementation-roadmap.md` §Phase 3 "Frontend Changes" deliverables exists** — inventory management UI, CRM pipeline and lead management, advanced financial reports, trainer commission statements, refund/credit-note processing UI. `grep -rniE 'inventory|crm|dunning|commission|clawback|payout|refund|credit-note|discount' apps/web/src` → **3 hits, all incidental** (`discounted_signups` in `components/ai/PlanPerformanceTable.tsx:91-92` and `lib/types.ts:347`). Concretely: **0** Phase 3 API client modules, **0** Phase 3 hooks, **0** Phase 3 routes. This is the shortfall §5.6 records. **Filed 2026-09-29** as backlog **P3-13 … P3-17** (`docs/task-backlog.md`) — **correction 2026-09-30: that filing never happened.** `grep -n '^### P3-1' docs/task-backlog.md` → no match, so no `P3-13`…`P3-17` entry exists; the only occurrences of those IDs anywhere in `docs/` were this claim and its duplicate in §7. These five deliverables remain **unbacklogged**, each marked *roadmap-scoped, not yet triaged* — the API-only vs roadmap-scope decision is the owner's
- [ ] **Member 360 UI (backlog P2-09)** — absent: there is no `/members/[id]` route at all (`apps/web/src/app/members/` contains only `page.tsx`), so the tab layout, lazy-loading wrappers, per-tab components and charts do not exist. Note the backlog targets `apps/web/pages/members/[id]/360.tsx` — a **Pages-Router** path — while `apps/web` is App Router, so that path must be rewritten before the task is actionable
- [ ] **Frontend lint (ESLINT-002)** — still skipped in CI (§7 Gates). `npm run lint` under `apps/web` cannot be read as green, and the `eslint` / `eslint-config-next` version conflict that caused the skip is unresolved
- [ ] **No frontend test suite at all** — `apps/web/package.json` declares **no `test` script**; the root `jest.config.js` (`testEnvironment: 'node'`, `testMatch: ['**/*.spec.ts']`, `collectCoverageFrom: ['src/**/*.ts', …]`) collects nothing under `apps/web`, and `find apps/web -name '*.spec.ts*' -o -name '*.test.ts*'` → **0**. The only artifact is `apps/web/__tests__/browser-verify.mjs` (a manual `fetch`-based script dated 2026-09-11) even though `@playwright/test ^1.63.0` is a declared devDependency — **zero** Playwright specs exist
- [ ] **P1-08's test acceptance criteria are unautomated** — "E2E login flow", "Navigation between pages", "Auth protection on routes", "Responsive layout". The pages and the guard exist; only their tests do not. This is what §8.2's browser-verification gap refers to
- [ ] **Route-level error and loading states** — no `error.tsx` and no `loading.tsx` anywhere under `apps/web/src` (only `not-found.tsx` exists)
- [ ] **Later-phase frontend, not started** (listed for planning completeness, not as a Phase 3 obligation): P6-05 analytics dashboards (`apps/web/analytics/`), P7-02 platform admin dashboard, P7-03 organization billing portal

**Docs**
- [ ] Commit `docs/event-contracts.md` (Inventory + CRM sections)
- [ ] Add the 7 missing Phase 3 tables to `docs/database-plan.md`
- [ ] Track `packages/contracts/src/events/{crm,inventory}.events.ts`
- [ ] Backlog: P3-08 and P3-09 entries present (`cb51f0ca`); P3-02/P3-06 bodies rejoined (`e241aaac`); P3-03/P3-04/P3-04b ordered (`1608cb31`); P3-10/P3-11/P3-12 remain unfiled, with no ruling attributed to them
- [ ] Backlog: open entries for the five `implementation-roadmap.md` §Phase 3 "Frontend Changes" deliverables (inventory UI, CRM pipeline, advanced financial reports, trainer commission statements, refund/credit-note UI) — **not filed — correction 2026-09-30: no `P3-13`…`P3-17` entry was created** (`grep -n '^### P3-1' docs/task-backlog.md` → no match), so these five remain unbacklogged and the API-only vs roadmap-scope decision stays with the owner (they were **unbacklogged** before this, which is why Phase 3 read as API-complete); and rewrite P2-09's stale Pages-Router path `apps/web/pages/members/[id]/360.tsx` before it is picked up — **not done** (false claim): the path still reads `apps/web/pages/members/[id]/360.tsx` at `docs/task-backlog.md:1493`; `git log -S 'apps/web/pages/members/[id]/360.tsx' -- docs/task-backlog.md` returns only the initial `449368cd` — **correction 2026-09-30:** there is **no App-Router member-detail route to rewrite it to**, so naming `apps/web/src/app/members/[id]/` + tabs as "its App-Router equivalent" was **false**. `apps/web/src/app/members/` contains only `page.tsx` — the flat list route — and no `360` file exists anywhere under `apps/web` (`git ls-files | grep -i 360` → only the backend `src/members/**/member-360.*`; `grep -rn '360' apps/web/src` → no match); see §7's accurate statement, *"there is no `/members/[id]` route at all"*. Only the **backend** half of Member 360 exists — `src/members/controllers/member-360.controller.ts`, `src/members/services/member-360.service.ts`, wired in `src/members/members.module.ts` (`:24`/`:30`/`:63`/`:72`/`:84`) — so P2-09's frontend target has to be **decided, not renamed**
- [ ] Amend or rule on the plan's remaining open §15 questions — **Q8** (discount ownership direction; the `Decision` at line 1063 explicitly leaves it open) and **Q11** (*gateway provider selection* — **plan** §15 numbering, as this line's own gloss indicates: `phase3-status-report.md` §6 Q11 is RLS, ruled 2026-09-26) — and settle the worker questions **Q13** (renewal trigger point) and **Q14** (dunning policy), both listed in §9.3. Plan §15 **Q5** (refund/credit-note lifecycle) is *not* outstanding: its `Decision` (line 1039) is recorded and §9.2 records it implemented as ruled — the similarly-numbered open question is `phase3-status-report.md` §6 Q5 (discount/tax ordering = plan §15 **Q9(a)**), already tracked in §3.5
- [x] RLS (status-report Q11): **ruled 2026-09-26 — formally deferred**; `database-plan.md`, backlog `P0-03`, roadmap, domain-map and completion-summary reconciled

**Repository**
- [x] Commit the uncommitted paths — **done 2026-09-30: 0 remain.** The last **7** (2026-09-28 reading: **4** modified tracked + **3** untracked — the untracked three included this report, which then had no committed baseline at all) landed in `08978034` (the 3 contract/doc artifacts `docs/event-contracts.md`, `crm.events.ts`, `inventory.events.ts`) and `bd19fca7` (this report plus the other Phase-3 docs). Down from **15** on 2026-09-27 because the memberships/discount/renewal work landed in `e16c1118` and `021dc160`. Gates were green on the pre-commit working tree (§1.1). *Dated history: this line read "12" when written on 2026-09-26, then "24" after the memberships work, then "15" on 2026-09-27 after the 9 paths landed in `3dee318a` (3 — DEF-01) and `d6c26095` (6 — RLS ruling).*
- [x] Push the unpushed commits on `main` — **done: at the `a5a32f77` baseline `origin/main` == local `main` and `git rev-list origin/main..main --count` → `0`** (the 2026-09-28 reading of **8** is superseded; see §2)
- [ ] Decide the `phase-6` integration path (82 commits apart; `phase-4` needs none — it is already in `main`)
- [ ] After committing: re-run `npm run typecheck && npm run lint && npx jest`, then re-confirm with `git ls-remote origin refs/heads/main` against local `HEAD`

---

## 8. Explicitly not verified in this session

1. **Runtime/API behaviour** of the Phase 3 endpoints — no server was started and no HTTP call was made; acceptance criteria are reported as *implemented + covered by unit/integration specs*, not as live-exercised.
2. **Browser-level verification** — none attempted. Phase 3 ships no UI surface (§5.6), and the existing `apps/web` routes were not exercised either: `apps/web/__tests__/browser-verify.mjs` was not run and no Playwright spec exists (§7). *(`implementation-roadmap.md` §Phase 3 does list five frontend deliverables — see §5.6 and §7 — so "no UI surface" is the backlog-backed scope of what was built, not a statement that the roadmap's Phase 3 UI exists.)*
3. **RLS behaviour** — nothing to test; no RLS exists (§5.1). RLS was **formally deferred by ruling on 2026-09-26**, so this is a settled scope boundary rather than a verification gap.
4. **Real Stripe interaction** — `STRIPE_SECRET_KEY` is deliberately unset for the test run; the adapter's live path is unexercised.
5. **`phase-6` (bbf73176) integration cost** — not measured here; it diverges from `main` by 82/8 commits (§2). `phase-4` (8ca91e4e) is an ancestor of `main`, so it needs no reconciliation.
6. **Column-level ERD fidelity** — §5.2 compares table names only, not columns; the plan's "add `organization_id` to the tables that lack it" item is unverified column-by-column.
7. **Concurrency/race behaviour beyond the pinned cases** — only what the specs cover (e.g. the payout-run 409, the discount lock) is known.

*Git state was independently confirmed against the live remote during this session:*
`git ls-remote origin refs/heads/main` → `b4b6464d2d1bc9795fcebcf036357943fa717d12`, local `main` → `d6c26095be8e43d149c5120529bb4a59b3d56124` → **6 local commits are not on the remote**.

---

## 9. Strict conformance to `docs/phase3-scoping-plan.md` — delta

Direct answer: **no — not strictly.** Conformance is high where it matters most (tenant scoping, single write paths, outbox-in-transaction, permission migrations, constants files, module encapsulation) and uneven in two places: **process** (decision points shipped before §15 was ruled) and **completeness** (four plan-named deliverables and 3 of 4 §12.3 documentation prerequisites are unfinished). Every claim below is traceable.

### 9.1 Followed strictly (spot-checked)

| Plan rule | Evidence |
|---|---|
| §12.3 permission-provision migrations, one per new permission set | `…254` (`finance:admin`), `…257` (`finance:refund`/`credit-note`), `…265` (`inventory:*`), `…267` (`crm:*`), `…271` (`pt:payout`) — all five exist |
| §11 modules export services, never repositories | `inventory.module.ts:18` → `exports: [InventoryService]`; `crm.module.ts:48` → `exports: [CrmService, FollowUpsService, SlaService]`. Names differ from §11's predicted `InventoryItemsService`/`LeadsService`; the pattern holds |
| §11 state value sets live in a domain constants file | `finance.constants.ts` (`REFUND_STATUS`, `CREDIT_NOTE_STATUS`), `crm.constants.ts` (`CRM_LEAD_STATUS`, `CRM_EVENT_TYPES`), `inventory.constants.ts` (`INVENTORY_TRANSACTION_TYPES`) |
| §2 line 175 / §6 line 515 — finance events unversioned, PT events versioned | `FINANCE_EVENT_TYPES` carries `RefundIssued`/`CreditNoteIssued`/`InvoiceOverdue`/`DunningEscalated` with no suffix; PT keeps `TrainerCommissionEarned.v1` and `PT_EVENT_VERSION` |
| §3 line 264 — the webhook route is the **only** unguarded finance route, and must be a documented exception | `gateway-webhook.controller.ts` → `@Post('payment-gateway')` + `@Public()`, no `@RequirePermissions`; every other new finance/CRM/inventory route carries one |
| §5 line 430 — dunning must not hard-code `[1, 3, 7]` | `grep '\[1,3,7\]' src/` → **0 hits**; dunning is interval-driven off `WORKER_INTERVALS.DUNNING` |
| §5 line 424 — no `RECURRING_BILLING` worker under option (b) | `worker-config.ts` has **no `RECURRING` key**; renewal is driven from the expiry worker (`membership-expiry.worker.ts:37`, with its own comment at `:35`: "Q13's default is renewal on expiry, sharing the expiry worker's cadence" — the comment's "Q13" is **plan §15 Q13**) |
| §7 — the four schema defects and the ERD tenancy defects fixed **at migration time** | `…264`: `organization_id` on suppliers/lots/transactions, net-new `INVENTORY_PURCHASE_ORDER_ITEMS` (line 14), stock derived into `MV_INVENTORY_STOCK_LEVELS` (line 17) — no `quantity_on_hand` column (§11 "derived figures are not denormalised") |
| §1 line 80 / §11 raw-SQL scoping | `ledger.service.ts:187,244` bind `WHERE organization_id = $1`; `ledger.constants.ts:4,148` reuse `OUTSTANDING_INVOICE_STATUSES` instead of re-declaring the list |
| §11 idempotency via a unique key | webhook events stored against a unique provider event id; refunds carry a key (§3.2); renewal uses `membership-renewal:{id}:{renewalDate}` |

### 9.2 Deviations that are recorded and approved

| Deviation | Where the approval lives |
|---|---|
| All three ledger objects are plain views; §1 recommended materialized for the two reporting ones (`MV_*` → `V_*`) | `…253-CreateFinanceLedgerViews.ts:23-25` + `__specs__/1788965263253-….spec.ts:79`. **Gap:** §15 **Q1 has no `Decision` line**, so the plan text still reads the other way and the approval is discoverable only in the migration |
| Refunds manual in P3-02, gateway-executed later; Model A (`Invoice.status` never rewritten) | §15 Q5 `Decision` (line 1039) — implemented as ruled |
| `FINANCE_PAYMENT_ALLOCATIONS` not built | §15 Q4 `Decision` (line 1032) — verified 0 hits in `src/` |
| Tax per **organization** — one tax regime per tenant | §15 Q6 `Decision` (line 1055) — `…255` |
| Tax exemption attached to the **member**, zero-rated tax line still written | §15 Q7 `Decision` (line 1059) — `…256` |
| `subtotal` = net of tax; no `InvoiceCreated.v2` | §15 Q9 `Decision` (line 1067) — its **(a)** sub-bullet was updated 2026-09-27 to record the discount-ordering ruling (*inside* the existing Decision block, so the `**Decision**`-line count this report asserts at §9.3 remains **six**) |
| Discounting split out of P3-04 into P3-04b | §15 Q8 `Decision` (line **1065** — it was 1063 before the 2026-09-28 update shifted the plan's line numbers) — the Decision records that **P3-04b was built in `021dc160`** and still says the ownership direction "*is **not** yet recorded as ruled*", while the shipped code already assumes Membership-owns/Finance-applies → §9.3 |

### 9.3 Implemented ahead of any ruling (no `Decision` line in §15) — the real non-conformance

`grep -n '\*\*Decision\*\*' docs/phase3-scoping-plan.md` returns **six** Decision lines — **Q4, Q5, Q6, Q7, Q8, Q9** (lines 1032, 1039, 1055, 1059, 1063, 1067). Every other resolved question was resolved **in code**, and the plan still lists it as open. That is **14** questions, listed below — this table is the authoritative count, and §9.8 and §9's fix list restate the same 14. **Q18 (loyalty redemption) is deliberately *not* counted**: it has no `Decision` line *and* nothing shipped against it (`src/loyalty/` holds the Phase 2 schema plus accrual only — `redeem` is a `LoyaltyTransaction` type, and `LoyaltyReward` is a registered entity with no workflow and no Phase 3 backlog item), and plan §15 Q18's own recommendation (line 1102) is to defer it again. **Q17 *is* counted**, on that same two-part test: it has no `Decision` line — the plan's only `Q17` occurrences are the cross-references at lines 175 and 515 and the question itself at 1098 — and something *was* shipped that a Decision would have governed: `packages/contracts/src/events/pt.events.ts` is present and **tracked** (created by `fa8c5212`, which also added the three PT commission events to `docs/event-contracts.md`), and the file's own docblock settles the naming half of the question.

| # | Plan question | What shipped anyway |
|---|---|---|
| **Q1** | ledger materialization strategy | plain views for all three (approval only in the migration — §9.2) |
| **Q10** | saved payment method storage, token security, `docs/security-plan.md` constraints | `FINANCE_PAYMENT_METHODS` (`…261`) + `POST /v1/members/:id/payment-methods` |
| **Q11** | gateway provider selection | Stripe adapter (`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`) — and neither variable is in `.env.example` |
| **Q12** | webhook processing model | persist-then-process: `FINANCE_WEBHOOK_EVENTS` (`…260`) + `WEBHOOK` worker key (5 s) + webhook processor (its *recommendation* was followed) |
| **Q13** | renewal trigger point — recommendation: option (b) "renew on expiry" | `renew()` + `renewDueMemberships()`, wired into `membership-expiry.worker.ts:37` *(committed 2026-09-28 in `e16c1118`)*. The recommendation **was** followed, but the code comment at `:35` refers to "Q13's default" while §15 still has no `Decision` line, so the plan and the code disagree about whether this is ruled |
| **Q14** | dunning attempt-counter owner, schedule shape | `attempt_number` 1 = overdue notice, 2 = escalation, no policy constant — tracked in §6 of this report |
| **Q15** | payout schema approach | option (a) payout-run pair (`…270`) — the recommended option, still unruled |
| **Q16** | clawback granularity | all-or-nothing reversal implemented |
| **Q17** | PT event contracts — create `packages/contracts/src/events/pt.events.ts` (recommended) *and* resolve the versioned-vs-unversioned naming inconsistency | the recommended file **was** created and is **tracked** (`fa8c5212`, 90 lines — the only commit touching it), and `docs/event-contracts.md:253-255` now documents the three commission events; its docblock (`pt.events.ts:3`) settles the naming half for PT ("PT events keep the module's existing version-in-the-name convention") with every `PT_EVENT_TYPES` value `.v1`. The *platform-wide* standardisation the question also asks for is still unmade on paper — §9.1 records finance unversioned vs PT versioned coexisting — so a `Decision` line is owed for code that already exists |
| **Q19** | **inventory costing — §12.2: "Do not start P3-05 until §15 Q19 (costing) is answered, because the answer changes the schema"** | **P3-05 was started anyway**: FIFO chosen in code (`INVENTORY_LOTS.unit_cost`, `IDX_inventory_lots_fifo`, `consumeFifo()`), no §15 line |
| **Q20** | stock level derived vs denormalised | derived + materialized view (the recommendation) — no §15 line |
| **Q21** | branch-level stock scoping | the plan's *conditional* branch was taken: `branch_id` on items **and** transactions (+ POs) — no §15 line |
| **Q22** | member auto-creation on conversion, trial-plan source | `POST /v1/leads/:id/convert` shipped — tracked in §6 |
| **Q23** | lead de-duplication | no unique index on `(organization_id, email)` / `(organization_id, phone)` and no merge endpoint — `…266` only defines `UQ_crm_sources_org_name` and `UQ_crm_conversions_org_lead`, so the *lead* dedup question is unruled (conversion idempotency is separately covered) |

> **Numbering caution:** every `Q<n>` in this table is a **`phase3-scoping-plan.md` §15** question — as is the "Q13" quoted in §9.1's worker row. `phase3-status-report.md` §6 numbers its own list independently, so a bare "Q11" is ambiguous: plan §15 Q11 = **gateway provider selection** (still open), status-report Q11 = **RLS** (ruled 2026-09-26 — deferred). The same applies to **Q5** and **Q8**, which earlier sections of this report cited bare and now name explicitly: status-report §6 Q5 (discount/tax ordering) = plan §15 **Q9(a)**, whereas plan §15 Q5 is *refund/credit-note lifecycle* — an unrelated question; and status-report §6 Q8 (operator-initiated renewal route) is unrelated to plan §15 Q8 (*membership discount ownership*).

### 9.4 Plan deliverables that are absent

| Plan reference | Deliverable | Evidence |
|---|---|---|
| §8 API table (line 683) | `GET /v1/leads/{id}/trials` | `grep -rn 'trials' src/crm/` → **0 hits** |
| §8 event table (lines 665–666) | `TrialStarted.v1`, `VisitCompleted.v1` | absent from `crm.constants.ts` and `crm.events.ts` → **5 of 7** CRM events implemented (§9 line 769 counts "CRM **eleven**"; 9 exist) |
| §6 API table (line 522) | `GET /v1/pt/commissions` | absent — `src/pt/controllers/` holds only `pt-enrollments.controller.ts` (`POST :id/cancel`) and `commission-payouts.controller.ts` (3 routes) |
| §1 + O3 (`api-plan.md:76`, `task-backlog.md:1627`) | `GET /v1/financial-ledger` | absent, and no ledger table could serve it — §1's own API table omits it (O3). *(Re-pointed 2026-09-27 from `:1622`: this session's P3-04b criterion edit in `task-backlog.md` added 5 lines above it.)* |
| §6 (line 513) / Q17 | `packages/contracts/src/events/pt.events.ts` | ✅ present **and tracked** (`git ls-files`) — the plan's "recommended" item is done, **but it was done ahead of any ruling**: Q17 has no `Decision` line, so this row is a completeness ✅ and a §9.3 ruling-discipline ✗ |
| §12.3 item 2 | `docs/database-plan.md` additions | `FINANCE_TAX_RATES` ✅, `MEMBERSHIP_DISCOUNTS` ✅; `INVENTORY_PURCHASE_ORDER_ITEMS`, `CRM_SLA_POLICIES`, `CRM_SLA_BREACHES` and the Q15-selected payout pair → **0 hits each** |
| §12.3 item 3 | `crm.events.ts`, `inventory.events.ts` | ✅ both exist **and are tracked** (`git ls-files` resolves both; committed in `08978034`) |
| §12.3 item 4 | backlog repairs | 4 false "completed in P1" annotations ✅; P3-08…P3-12 entries ✗; P3-03/P3-04 renumbering ✗ |

### 9.5 Build order vs §12.1/§12.2

* **§12.2's only "non-negotiable" rule held** — P3-04 (tax, migrations `…255`/`…256`, `eab95ced`) precedes all renewal work, which was still uncommitted when §12 was checked on 2026-09-27 and has since been committed in `e16c1118` (2026-09-28).
* **§12.1's sequence was not followed as a merge order**: migration `…264` (P3-05, wave 3, order 9) and `…269` (P3-08, wave 2, order 5) were added by the **same** commit `b4b6464d`; `…270` (P3-12, order 8) by `fa8c5212`, i.e. after inventory/CRM. §12.2's "P3-11 is the cheapest finance win… good candidate for an early merge" also did not happen — clawback landed in `823c00d5`, after the finance cluster.
* **Inventory ∥ CRM was respected** (both in one batch, `…264`–`…268`), matching §12.1's "parallelisable".
* **Q19 gating was broken** (§9.3).

### 9.6 Additions beyond the plan (additive surface)

| Addition | Note |
|---|---|
| `GET /v1/refunds/:id`, `GET /v1/credit-notes/:id`, `GET /v1/tax-rates/:id` | not in §2/§4's tables or the backlog |
| SLA policy CRUD (`GET`/`POST /v1/sla/policies`, `PATCH /v1/sla/policies/:id`, `crm:update`) | §9 line 758 flagged exactly this as a missing configuration API — closed without a backlog entry |
| `GET /v1/leads/pipeline`, `GET /v1/inventory/stock`, `POST /v1/inventory/transactions/consume`, `GET /v1/inventory/purchase-orders`, `POST /v1/purchase-orders/:id/receive` | §7 contains **no API table at all** (plan O1), so inventory's surface can only be compared with `api-plan.md:137–143` — and it does not match: `GET`/`PATCH /v1/inventory/items/{id}`, `GET /v1/inventory/lots` and `POST /v1/inventory/transactions` are **not implemented**, while stock/consume/receive are **not in api-plan**. Bidirectional divergence, already listed in §7's outstanding checklist |
| `WEBHOOK` worker key at 5 s | §3 line 268 raised this as a Q12 item rather than a deliverable |
| `src/pt/controllers/` now exists | plan O4 asserted it did not; still accurate about the prefix decision — §6's `/v1/pt/…` was chosen, diverging from `api-plan.md`'s flat PT prefixes |

### 9.7 Plan statements that are now stale (plan-side, not code-side)

* O4's "`src/pt/` contains no `controllers/` directory at all" — false since P3-11/P3-12.
* §11's predicted export names (`InventoryItemsService`, `LeadsService`) and its claim that inventory reuses `toMoney()`/`sumMoney()` — `grep -rl 'toMoney\|sumMoney' src/inventory` → **0 files** (finance 7, pt 2).
* §7's ERD excerpt (`INVENTORY_INVENTORY_ITEMS`, `INVENTORY_INVENTORY_TRANSACTIONS`, …) vs the implemented names (`INVENTORY_ITEMS`, `INVENTORY_TRANSACTIONS`, …) — the plan quotes the ERD verbatim; the code follows the migration convention.

### 9.8 Verdict

* **Architecture, tenancy and transactional discipline: conformant.** No deviation from the tenant-isolation chain, the single-write-path rule, or outbox-in-transaction was found anywhere in Phase 3.
* **Ruling discipline: not conformant.** **14** §15 questions were decided in code with no `Decision` line — the explicit list in §9.3 (Q1, Q10, Q11, Q12, Q13, Q14, Q15, Q16, **Q17**, Q19, Q20, Q21, Q22, Q23). The "~14" this line originally carried was the right total resting on the wrong item: the candidate behind it, **Q18**, ships nothing and is excluded (no built behaviour, so no ruling can be owed), while **Q17** — never in the earlier enumeration — ships a **tracked** contract file (`fa8c5212`) and belongs in the count. One of the 14 (Q19) was shipped against an explicit "do not start until answered" instruction, and plan §15 Q8's "do not assume" instruction was likewise overtaken by shipped code.
* **Completeness: not conformant.** Four plan-named deliverables are absent (`GET /v1/leads/{id}/trials`, `TrialStarted.v1`, `VisitCompleted.v1`, `GET /v1/pt/commissions`), plus the O3 `GET /v1/financial-ledger` omission, and 3 of the 4 §12.3 documentation prerequisites are unfinished.
* **Cheapest fixes that move this to "conformant":** add the missing `Decision` lines for the **14** plan §15 questions listed in §9.3 — Q1, Q10, Q11, Q12, Q13, Q14, Q15, Q16, **Q17**, Q19, Q20, Q21, Q22, Q23 (paper only, no code — note §15 Q11 here is *gateway provider selection*, distinct from `phase3-status-report.md` §6 Q11 = RLS, which was ruled on 2026-09-26); record the ledger plain-view approval in §15 Q1; finish `database-plan.md` and the backlog; then rule on the **six** rows §6 still lists as open — **Q1, Q3, Q6, Q8, Q9, Q10** (Q11/RLS closed 2026-09-26 and Q5/ordering ruled 2026-09-27 — §3.5; of those six, only **Q8** is still marked *and blocking*). The “five … of six” formulation this line previously carried was not derivable from §6's own table (11 rows) and has been replaced with that explicit list.


