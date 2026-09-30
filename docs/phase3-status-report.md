# Phase 3 Status Report — Verified

**Date:** 2026-09-25
**Scope:** `docs/phase3-scoping-plan.md` (§1–§15) and `docs/task-backlog.md` (P3-01 … P3-12, incl. P3-04b, and DEF-01)
**Method:** read-only inspection of the working tree plus command output captured to files. Every claim below is backed by a command in §1 or §2; anything not reproduced is marked **UNVERIFIED**.

**Legend:** ✅ complete · 🚧 partial · ❌ missing · ⚠️ risk/observation · 📋 not in Phase 3 scope

---

## 0. State as of `021dc160` — 2026-09-28 (read this before the dated sections below)

**Every Phase 3 item is now committed. Every `(uncommitted)` / `(untracked)` label below is dated and superseded.**

The commit boundary that §2 measured on 2026-09-25 no longer exists. Twelve of the thirteen Phase 3 items are committed on `main`; the thirteenth — **P3-10 — is not started** *(superseded 2026-10-01: config shipped, key builders deferred — see the table row below)*. Where each item landed (`git log`, 2026-09-28):

| Item | Committed in |
|------|--------------|
| P3-01 Financial Ledger Read Model | `24f1a300` (present at the `c7f84c08` baseline) |
| P3-02 Refunds and Credit Notes | `8f305a60` (present at the `c7f84c08` baseline) |
| P3-03 Payment Gateway Integration | `b4b6464d` |
| P3-04 Tax Handling (tax-only) | `eab95ced` (present at the `c7f84c08` baseline) |
| P3-04b Membership Discounts | `021dc160` |
| P3-05 Inventory Management | `b4b6464d` |
| P3-06 CRM Lead Management | `b4b6464d` |
| P3-07 Follow-ups and SLAs | `b4b6464d` |
| P3-08 Dunning | `b4b6464d` |
| P3-09 Recurring Billing / Renewal | `e16c1118` |
| **P3-10 Storage Configuration** | **config shipped 2026-10-01; key builders deferred** *(this row as of 2026-09-28 read "not started")* — `@Global()` `b71decf3`, `S3_LOCAL_ROOT`/`S3_DOCUMENTS_BUCKET`/`AWS_REGION` `387f706c`, `uploads/` ignored `a38bead9`; `buildCrmAttachmentKey()`/`buildInventoryImageKey()` still absent |
| P3-11 Commission Clawback | `823c00d5` |
| P3-12 Commission Payout | `fa8c5212` |
| DEF-01 `is_active` inversion | `3dee318a` |
| RLS deferral (status-report §6 Q11) | `d6c26095` |

**Committed at the `a5a32f77` baseline — the tree is clean and nothing is uncommitted.** Every path this section previously listed has since landed. Measured 2026-09-30:

```
$ git rev-parse HEAD
a5a32f77f0a05d1080d6a73cc2a46b66ac4c4885
$ git status --porcelain --untracked-files=all
(empty)
$ git rev-list origin/main..main --count
0
```

`docs/event-contracts.md`, `packages/contracts/src/events/crm.events.ts` and `packages/contracts/src/events/inventory.events.ts` were committed in **`08978034`** (`docs/event-contracts.md` `56/0`, `crm.events.ts` `30/0`, `inventory.events.ts` `53/0`); `phase3-completion-checklist-report.md`, previously **untracked** so that it had no committed baseline at all, was committed in **`bd19fca7`** (status `A`). The 2026-09-28 reading of "7 paths / `rev-list` → 8" is superseded and retained only as history. *(Reconciled 2026-09-30: every count quoted in this block is the `a5a32f77` baseline.)*

**Superseded readings.** §2's `MODIFIED 41 / UNTRACKED 51`, its "12 migrations `…260`…`…271` are untracked", §1.1's "the working tree does not boot", and every `(uncommitted)` / `(uncommitted, partial)` parenthetical in §3 and §7 record the tree on **2026-09-25 / 2026-09-26 / 2026-09-27**. They are retained as history, not as current status. The per-item headings in §3 and the §7 summary have been updated to the committed state above.

**Unchanged by the commits:** P3-10 not started *(superseded 2026-10-01: config shipped in `b71decf3`/`387f706c`/`a38bead9`; the key builders remain deferred)*; the four P3-05 endpoints and two P3-05 workers still absent; the missing P3-04b entity spec; the absent operator renewal route; the undocumented Stripe keys; the backlog gaps; and the open §15 rulings. A commit changes where the code lives, not what it does.

**Classifier provenance — corrected 2026-09-29.** An earlier pass recorded an "A/B/C" proof-claim classifier and its result as `A/B/C = 0`. That classifier could not be located: a search of the shell history (`~/.bash_history` and `~/.bash_history-04167.tmp`), of every report under `docs/`, and of the scripts in the repo (`scripts/`, plus a repo-wide `classif` / `A/B/C` / `A=0` / `B=0` / `C=0` grep) returned **no** definition of it, so it **was not re-run**. The earlier `A/B/C = 0` result is therefore **superseded by the U/bare check** (the `UNVERIFIED`-marker / bare, command-less-claim audit whose labelling is applied in §7 below) and **was not re-confirmed**. The earlier invariant is **not** asserted to still hold.

---

## 1. Verification evidence

All four gates were run on the **working tree** on 2026-09-25 — the tree at that date still included the Phase 3 work that §0 now records as committed, so the green results below describe the pre-commit tree — and green:

| Gate | Command | Result |
|------|---------|--------|
| Backend typecheck | `npm run typecheck` → `tsc --noEmit -p tsconfig.spec.json` | `EXIT=0` |
| Lint | `npm run lint` → `eslint . --ext .ts` | `EXIT=0` |
| Web typecheck | `cd apps/web && npm run typecheck` → `tsc --noEmit -p tsconfig.json` | `EXIT=0` |
| Backend tests | `npx jest --silent` | `Test Suites: 103 passed, 103 total` / `Tests: 1069 passed, 1069 total` / `EXIT=0` |

Migrations replay cleanly on a **fresh** database (dev server `127.0.0.1:5433`):

```
0 migrations are already loaded in the database.
45 migrations were found in the source code.
45 migrations are new migrations must be executed.
RUN_EXIT=0
SHOW_EXIT=0   # migration:show — every migration listed [X]
```

Fresh DB name: `gym_p3_final_1790355250` — **created and dropped** during verification; `migration:run` and `migration:show` both exited 0.

### 1.1 Boot probe — the working tree does not boot

`AppModule` was compiled with `Test.createTestingModule({ imports: [AppModule] }).compile()`. Three variants, captured verbatim:

```
RESULT A(workersLoaded,STRIPE unset): FAILED -> Nest can't resolve dependencies of the WebhookEventWorker (ConfigService, SchedulerRegistry, ?). Please make sure that the argument WebhookEventProcessor at index [2] is available in the WorkersModule context.
RESULT B(workersStubbed,STRIPE unset): FAILED -> Neither apiKey nor config.authenticator provided
RESULT C(workersStubbed,STRIPE set): COMPILED
```

As of 2026-09-25 this isolated **two independent boot blockers** in the then-uncommitted tree (detail in §4). **Both are fixed and committed — in `b4b6464d` (2026-09-28); see §0.** The finding is retained as the dated reading, not as current status:

1. **BLOCKER-1 — missing module export.** `WorkersModule` (`workers.module.ts:27`) imports `FinanceModule` and provides `WebhookEventWorker`, whose constructor needs `WebhookEventProcessor`. `FinanceModule`'s `exports` array (`finance.module.ts:122-134`) contains **neither** `WebhookEventProcessor`, `GatewayWebhookService`, nor `StripePaymentGatewayAdapter`. Nest therefore cannot resolve the worker. This fails **regardless of whether `STRIPE_SECRET_KEY` is set**.
2. **BLOCKER-2 — unconditional Stripe construction.** With `WorkersModule` stubbed out, the next failure is from `GatewayWebhookService` (`gateway-webhook.service.ts:18`):

   ```ts
   this.stripe = new Stripe(config.get<string>('STRIPE_SECRET_KEY', ''));
   ```

   An empty/missing key makes the Stripe SDK throw `Neither apiKey nor config.authenticator provided` **during DI instantiation**. Contrast `StripePaymentGatewayAdapter` (`stripe-payment-gateway.adapter.ts:13-17`), which correctly guards with `this.isConfigured = Boolean(key)` and only constructs the client when a key is present. With `STRIPE_SECRET_KEY=sk_test_dummy` the module compiles.

### 1.2 Committed HEAD **does** boot

Same probe run inside a detached worktree of `c7f84c08` (symlinked `node_modules`, copied `.env`):

```
HEADBOOT: COMPILED
```

So, as of 2026-09-25, the boot breakage was introduced **entirely by work that had not yet been committed** — at that date it was not a defect in the committed branch. (Both blockers were fixed and committed in `b4b6464d`; the sentence is retained as the 2026-09-25 reading — see §0.)

### 1.3 DEF-01 reproduced

```
is_active=true  -> typeof=boolean value=true  errors=0
is_active=false -> typeof=boolean value=true  errors=0
is_active=0     -> typeof=boolean value=true  errors=0
is_active=1     -> typeof=boolean value=true  errors=0
is_active=FALSE -> typeof=boolean value=true  errors=0
```

`?is_active=false` filters for **active** plans and raises no validation error, exactly as the backlog's DEF-01 entry describes.

> **FIXED (2026-09-27) — `3dee318a`.** The transcript above is preserved unchanged as the observation made on the date of this report. `QueryMembershipPlanDto.is_active` has since been converted to the explicit `@Transform(({ value }) => value === true || value === 'true')` form, and the regression spec the backlog named now exists, so the behaviour above no longer reproduces. See the DEF-01 entry in §3.

---

## 2. Repository state and the commit boundary

This is the single most important finding in the report: **the working tree contains far more Phase 3 work than has been committed.**

| Ref | Commit | Relation |
|-----|--------|----------|
| local `main` | `c7f84c08` | `docs(finance): mark the refundedTotal regression test as written, not pending` |
| `origin/main` | `c7f84c08` | identical to local `main` — in sync |
| `phase-4` worktree | `8ca91e4e` | contains `main` history |
| `phase-6` worktree | `bbf73176` | **contains `main`** (`git merge-base --is-ancestor c7f84c08 bbf73176` → true); `origin/phase-6: ahead 9` |

*2026-10-01: the `origin/main` / `c7f84c08` row above is a **historical reading**, not a current claim. `git merge-base --is-ancestor c7f84c08 HEAD` → **exit 0 (true)**, so `c7f84c08` is an ancestor of `HEAD` (history), not the current tip. No current push state is asserted here.*

`bbf73176` is **not** an ancestor of `main`. `55a22b9b` is `Merge origin/main (Phase 3 finance) into phase-6 (Phase 6 reports)` and is contained by `phase-6` / `origin/phase-6` only.

Working tree vs HEAD:

```
MODIFIED (tracked): 41
UNTRACKED:          51
TOTAL:              92
```

**Tracked on `main` (committed) as of 2026-09-25:** P3-01, P3-02, P3-04. Migrations ran through `1788965263259`. *(As of 2026-09-28 every Phase 3 item except P3-10 is committed — see §0.)*

**Untracked (uncommitted) as of 2026-09-25:** everything else — 12 migrations `1788965263260`…`1788965263271`, all of P3-03, P3-04b, P3-05, P3-06, P3-07, P3-08, P3-09, P3-11, P3-12, plus the new worker and contract files. *(All of it is committed as of 2026-09-28; the list is retained as the 2026-09-25 reading — see §0.)*

`git grep` on `HEAD` for `StripePaymentGatewayAdapter|GatewayWebhook|WebhookEventProcessor|WebhookEventWorker|DunningWorker|CrmFollowUpsWorker|CrmSlaMonitorWorker` returns **nothing**, and `git ls-tree -r HEAD` has **zero** entries under `src/inventory/` or `src/crm/`.

⚠️ **Consequence** *(as of 2026-09-25; the boundary this describes was closed on 2026-09-28 — see §0)*: the green CI gates in §1 validated the working tree as it then stood. Anyone who cloned `origin/main` at that date got only §3's ✅ items; anyone who checked out `main` as-is got a coherent, bootable, but **much smaller** Phase 3. The boot blockers in §1.1 existed only in the uncommitted state, so CI (which runs typecheck, lint, web typecheck and jest — see `.github/workflows/ci.yml`) was never in a position to catch them. **The durable half of this finding is unchanged:** CI still cannot boot the application, so green gates remain no evidence that the tree starts at all — `src/app.boot.spec.ts`, committed in `b4b6464d`, is what closes that gap.

**Commit boundary, per artifact** *(re-verified 2026-09-27 with `git ls-files`: in the `…260`–`…271` range only `…262` was still untracked (now committed in `021dc160`, 2026-09-28); the others are committed — `…260` and `…263` in `b4b6464d`, `…271` in `fa8c5212` — so the "UNTRACKED" run below was stale from `…260` upward and `:117` contradicted §P3-04b below):*

```
TRACKED   …259-AddRefundsAndCreditNotesToFinanceLedgerViews.ts
TRACKED   …260-AddPaymentGatewayAndWebhookEvents.ts
TRACKED   …261-CreateFinancePaymentMethods.ts
TRACKED   1788965263262-CreateMembershipDiscounts.ts   <- committed in `021dc160` (2026-09-28); was the only uncommitted migration in this range on 2026-09-27
TRACKED   …263-CreateInvoiceDiscountSnapshots.ts
TRACKED   …264-CreateInventorySchema.ts
TRACKED   …265-ProvisionInventoryPermissions.ts
TRACKED   …266-CreateCrmLeadManagement.ts
TRACKED   …267-ProvisionCrmPermissions.ts
TRACKED   …268-CreateCrmFollowUpsAndSla.ts
TRACKED   …269-CreateFinanceDunningAttempts.ts
TRACKED   …270-CreatePtCommissionPayoutTables.ts
TRACKED   …271-ProvisionPtPayoutPermission.ts
```

Note also that, as of 2026-09-25, `finance.module.spec.ts` — a **tracked** file — had been modified in the working tree to reference `WebhookEvent`, `PaymentMethod`, `PaymentMethodsService` and `PaymentMethodsController`, so the committed copy of that spec did not at that date match the committed copy of `finance.module.ts`. *(That edit is now committed — `b4b6464d`; `git status --porcelain` reports no modification to the file as of 2026-09-28.)* At the same time, a grep of that spec for `GatewayWebhookService`, `StripePaymentGatewayAdapter`, `WebhookEventProcessor` and `DunningService` returns **0** matches for every one of them: the P3-03 providers are wired into the module but are **not covered by the module-wiring spec**, which is precisely why the missing `exports` in §1.1 went unnoticed. That spec only asserts `PAYMENT_GATEWAY` resolves to `UnavailablePaymentGateway` with `isConfigured === false` — it never loads the Stripe adapter at all.


---

## 3. Task-by-task status

### ✅ P3-01 — Financial Ledger Read Model (committed)

Three **plain (non-materialized) views** built by migration `1788965263253`, plus the credit-aware follow-up `1788965263259`:
`V_FINANCE_MEMBER_OUTSTANDING`, `V_FINANCE_REVENUE_BY_PERIOD`, `V_FINANCE_OUTSTANDING_BY_STATUS`.
`LedgerService`, `ledger.controller.spec.ts` and `ledger.service.spec.ts` are present. Status lists and ageing buckets are generated from `src/finance/ledger.constants.ts` rather than re-typed in SQL, and a `__specs__` entry pins that lockstep.

⚠️ **Documented deviation from §1:** §1's recommended default was **materialized** views for the two reporting objects; the approved decision was plain views for all three, so `MV_*` became `V_*`. The migration header records this, notes that a plain view cannot carry an index (hence a composite index on the base tables), and explains that `CURRENT_DATE`/`now()` is therefore evaluated per query rather than frozen at refresh. §1's credit-note/refund terms were deliberately omitted from `…253` and landed in `…259` once P3-02 shipped — deferred, not faked.

### ✅ P3-02 — Refunds and Credit Notes (committed)

`RefundsService`, `CreditNotesService`, `Refund`/`CreditNote` entities, `FINANCE_REFUNDS` via `1788965263258`, permissions via `1788965263257`. Confirmed against the dev database:

```
FINANCE_REFUNDS columns: id, organization_id, payment_id, reason, amount,
                         refund_date, status, created_at, idempotency_key
FINANCE_PAYMENTS new cols: gateway_reference, gateway_response, gateway_status
```

Acceptance criteria (`amount <= payment`, `amount <= invoice`, ledger impact, no over-refund) are pinned by `refunds.service.spec.ts`, `credit-notes.service.spec.ts`, and the `refundedTotal` regression test committed in `8140d64f`.

### ✅ P3-03 — Payment Gateway Integration (committed in `b4b6464d`)

Artifacts untracked as of 2026-09-25 — **all of them now committed** (P3-03 landed in `b4b6464d`; see §0): `stripe-payment-gateway.adapter.ts`, `gateway-webhook.service.ts`, `webhook-event.processor.ts`, `webhook-event.worker.ts`, `gateway-webhook.controller.ts` (`POST v1/webhooks/payment-gateway`), `payment-methods.controller.ts` (`POST :id/payment-methods`), migrations `…260`/`…261`, plus specs for the adapter, the processor, payment-methods and dunning.

*(The rows below are the 2026-09-25 reading. The boot blocker that made the webhook and refund paths unreachable — BLOCKER-1, the missing `FinanceModule` export — was fixed and committed in `b4b6464d`; see §0 and §1.1.)*

| Criterion | State |
|-----------|-------|
| Payments processed via gateway | 🚧 adapter written; `PAYMENT_GATEWAY` still resolves to `UnavailablePaymentGateway` when no key is configured |
| Webhooks handled idempotently | 🚧 *(2026-09-25)* `WebhookEvent` + `provider_event_id` lookup implemented; **unreachable** because the app could not boot (BLOCKER-1 — fixed in `b4b6464d`, §1.1) |
| Failed payments retry appropriately | 🚧 retry path rewired; tests green |
| Refunds processed via gateway | 🚧 *(2026-09-25)* `RefundsService.applyGatewayOutcome()` + processor wiring present; **unreachable** (same boot blocker — fixed in `b4b6464d`) |

✅ **`PAYMENT_GATEWAY` binding is correct** — the diff replaces the old static `useExisting: UnavailablePaymentGateway` with a `useFactory` that returns `stripe.isConfigured ? stripe : new UnavailablePaymentGateway()`, which is the right shape.

⚠️ **By default this still yields the unavailable gateway, for two compounding reasons.** First, with no `STRIPE_SECRET_KEY` the adapter reports `isConfigured === false`, so the factory falls back to `UnavailablePaymentGateway` — stripe never actually processes payments out of the box. Second, the two keys the code reads are documented **nowhere**: `.env.example`, `docs/` and `.github/` all have **0** matches for `STRIPE`. An operator following the repo's own instructions cannot configure a gateway, and cannot even discover that the integration exists.

❌ **BLOCKER-1 — the missing `exports`.** `WorkersModule` provides `WebhookEventWorker`, whose third constructor argument is `WebhookEventProcessor`. `FinanceModule`'s `exports` array (`finance.module.ts:128-132`) was extended with only `PaymentMethodsService` and `DunningService`; `GatewayWebhookService`, `WebhookEventProcessor` and `StripePaymentGatewayAdapter` are **providers but not exports**. Nest therefore cannot resolve the worker:

```
RESULT A(workersLoaded,STRIPE unset): FAILED -> Nest can't resolve dependencies of the WebhookEventWorker (ConfigService, SchedulerRegistry, ?). Please make sure that the argument WebhookEventProcessor at index [2] is available in the WorkersModule context.
```

This failure is independent of `STRIPE_SECRET_KEY` — it happens with the key set too.

❌ **BLOCKER-2 — unconditional Stripe construction in a provider's constructor.** With `WorkersModule` stubbed, `AppModule` still fails because `GatewayWebhookService` runs this at line 18:

```ts
this.stripe = new Stripe(config.get<string>('STRIPE_SECRET_KEY', ''));
```

An empty/missing key makes the Stripe SDK throw `Neither apiKey nor config.authenticator provided` **during DI instantiation**, so the whole application fails to boot rather than degrading gracefully:

```
RESULT B(workersStubbed,STRIPE unset): FAILED -> Neither apiKey nor config.authenticator provided
RESULT C(workersStubbed,STRIPE set): COMPILED
```

The contrast with `StripePaymentGatewayAdapter` is instructive: the adapter (`stripe-payment-gateway.adapter.ts:13-17`) guards correctly, doing nothing until `this.isConfigured = Boolean(key)` is true. `GatewayWebhookService` forgot the same guard. **This is the more serious of the two blockers** — it means a missing *optional* credential takes down every unrelated endpoint, not merely the webhook feature.

**Why CI never caught either one:** `finance.module.spec.ts` provides the payment-method controller and entity but its grep count for `GatewayWebhookService`, `StripePaymentGatewayAdapter`, `WebhookEventProcessor` and `DunningService` is **0 for all four**. The spec asserts only that `PAYMENT_GATEWAY` resolves to `UnavailablePaymentGateway` with `isConfigured === false`, so it never constructs the Stripe adapter or the webhook processor. The missing exports and the unguarded constructor are both outside the spec's reach — which is precisely why a green suite coexists with a non-booting application.


### ✅ P3-04 — Tax Handling, tax-only (committed)

`FINANCE_TAX_RATES` per organization (`…255`), `MEMBERS_MEMBERS.tax_exempt` + `tax_exempt_reason` (`…256`), `computeLineTax()` / `computeInvoiceTotals()` / `toMoney()` / `sumMoney()` centralised in `src/finance/finance.constants.ts`, `TaxRatesService` + `TaxRatesController`, `tax_lines` on the invoice read API, and the `finance:admin` permission (`…254`).

Q9 rulings are implemented as recorded: **(b)** `subtotal` is net of tax, `tax_amount` is the sum of per-line tax values (never recomputed from the summed subtotal), `total_amount = subtotal + tax_amount`; **(c)** no `InvoiceCreated.v2` — `InvoiceCreated.v1` stays byte-identical for callers that pass no `tax_code`.

### ✅ P3-04b — Membership Discounts (committed in `021dc160`; discount/tax ordering ruled 2026-09-27)

⚠️ **Dated reading (2026-09-25) — superseded 2026-09-28 by `021dc160`.** As recorded then, this item straddled the commit boundary and the split mattered: HEAD's `invoices.service.ts` had **zero** matches for `discount` (`git show HEAD:src/finance/services/invoices.service.ts | grep -ci discount` → `0`), so the committed service had no discount handling at all; the tax-aware discount math and the `InvoiceDiscount` snapshot were uncommitted edits to a tracked file; and the schema/route half — `membership-discount.entity.ts`, `create-membership-discount.dto.ts`, migration `…262` (`MEMBERSHIP_MEMBERSHIP_DISCOUNTS`), migration `…263` (`FINANCE_INVOICE_DISCOUNTS`) and the `POST /v1/memberships/:id/discount` route (`memberships.controller.ts:69`, gated on existing `membership:update`) — was untracked. (That list over-counted: `…263` was in fact already committed in `b4b6464d`, which §2's note above already flags.) The conclusion drawn at the time was that **nothing about P3-04b was committed**, and that `MEMBERSHIP_MEMBERSHIP_DISCOUNTS` — the table the backlog recorded as absent ("verified 2026-09-17") — existed in the working tree only.

**Current state (2026-09-28): committed in `021dc160`.** The discriminator that exposed the boundary has flipped. `git show HEAD:src/finance/services/invoices.service.ts | grep -ci discount` now returns **17**, not `0`; `git ls-files --error-unmatch src/migrations/1788965263262-CreateMembershipDiscounts.ts` succeeds; and `MEMBERSHIP_MEMBERSHIP_DISCOUNTS` now exists in committed code, not only in the working tree. The paragraph above is retained as the record of the pre-commit split.

The committed design it builds on is what makes the criterion below reachable at all:


```ts
const discountAmount = input.discount
  ? input.discount.discount_type === 'percentage'
    ? Math.min(price, price * Number(input.discount.amount) / 100)
    : Math.min(price, Number(input.discount.amount))
  : 0;
const netAmount = toMoney(price - discountAmount);
```

✅ **RESOLVED — the criterion was relaxed, not the code. Ruled 2026-09-27.** As verified on 2026-09-26, there is no configuration surface: a repo-wide grep for `discount_before_tax|discount_order|discountAfterTax|discount_after_tax|beforeTax` across `src/` and `packages/` returns **zero** matches, and the implementation is **hard-coded discount-before-tax** — the price is reduced first, then tax is computed on the net amount. That is exactly the forward-compatible shape §15 Q9(a) deferred. **Ruling (§15 Q9(a), 2026-09-27):** the ordering is **fixed by design — discount before tax — and configurable ordering will not be built**; the rationale is that no known customer or jurisdiction requirement for the alternative ordering has emerged, so a stored ordering property would be configuration with no reader, while adding one later is additive and removing one is not. Revisit only if such a requirement emerges. The artifact at fault was therefore the *criterion*, not the code: `phase3-scoping-plan.md` §4 and `docs/task-backlog.md` P3-04b now state “discounts applied **before** tax”. No code change is implied, and the ruled order is pinned by `invoices.service.spec.ts:330`.

⚠️ The ownership direction of §15 Q8 (`Membership owns the definition; Finance applies it`) **is** satisfied in practice and is now **committed** — the definition lives in `src/memberships/entities/membership-discount.entity.ts`, the application in `src/finance/services/invoices.service.ts`, both in `021dc160`. What remains open is the *paper*, not the code: §15 Q8 still records the direction as not ruled (plan §15, updated 2026-09-28), so the shipped direction should be confirmed as the ruling rather than left implicit.

❌ No combined tax+discount scenario spec, and neither `membership-discount.entity.ts` nor `create-membership-discount.dto.ts` has a sibling spec. *(Corrected 2026-09-27: the “no combined tax+discount scenario spec” half of this line was **wrong** — that spec exists at `invoices.service.spec.ts:330`, asserting tax is computed on the discounted amount rather than the original price, with the no-active-discount regression case at `:352`. The entity/DTO spec gap is real and still stands.)*

### ✅ P3-05 — Inventory Management (committed in `b4b6464d`, still partial)

Six entities (`inventory-item`, `inventory-lot`, `inventory-supplier`, `inventory-transaction`, `inventory-purchase-order`, `inventory-purchase-order-item`), migrations `…264`/`…265`, `inventory.controller.spec.ts`. Routes actually registered:

```
GET  suppliers          POST suppliers
GET  items              POST items
GET  purchase-orders    POST purchase-orders
POST purchase-orders/:id/receive
GET  stock
POST transactions/consume
```

❌ **Missing against the backlog's API list:** `GET /v1/inventory/items/{id}`, `PATCH /v1/inventory/items/{id}`, `GET /v1/inventory/lots`, `GET /v1/inventory/purchase-orders/{id}`, and `POST /v1/inventory/transactions` (a `transactions/consume` endpoint exists instead — same intent, different path).

❌ **No workers.** The backlog asks for an inventory reorder worker and an expiry-checker worker; neither exists in `src/shared/workers/`.

Acceptance: SKU/description/cost ✅, stock levels updated on transactions ✅, purchase orders created and received ✅, **lot expiry tracking 🚧** — `inventory-lot.entity.ts` and its migration exist, but nothing schedules or exposes expiry checking.

### ✅ P3-06 — CRM Lead Management (committed in `b4b6464d`)

`src/crm/` module with entities `lead`, `lead-activity`, `lead-source`, `lead-stage`, `conversion`; migrations `…266`/`…267`; `crm.service.spec.ts`. Routes on `@Controller('v1/leads')`: `GET`, `GET pipeline`, `GET :id`, `POST`, `PATCH :id`, `POST :id/activities`, `POST :id/convert`, `POST :id/follow-ups`.

Conversion is guarded against double-conversion both by status/`member_id` and by an existing `CRM_CONVERSIONS` row, and it creates the member through the members module rather than duplicating member writes.

❌ `packages/contracts/src/events/crm.events.ts` has no sibling spec.


### ✅ P3-07 — Follow-ups and SLAs (committed in `b4b6464d`)

`CRM_FOLLOW_UPS` (+ SLA columns), `CRM_SLA_POLICIES` and `CRM_SLA_BREACHES` (entities `follow-up`, `sla-policy`, `sla-breach`) via migration `…268`; `FollowUpsService`, `SlaService`. Routes match the backlog:

```
@Controller('v1/follow-ups')  GET due          POST :id/complete
@Controller('v1/sla')         GET reports      GET policies
                              POST policies    PATCH policies/:id
```

Both requested workers exist **with specs**: `crm-follow-ups.worker.ts` and `crm-sla-monitor.worker.ts`, with intervals and batch sizes added to `worker-config.ts` (`CRM_FOLLOW_UPS: 30m/100`, `CRM_SLA_MONITOR: 15m/100`) — the monitor runs twice as often as the scheduler, with the reasoning recorded in a comment.

Escalation runs in the executed suite (captured output): `Recorded 3 overdue follow-up breach(es) and 1 first-response breach(es)` and `Escalated 2 SLA breach(es)`. §9's ⚠️ note that `CRM_FOLLOW_UPS` lacked `created_at` in the ERD is resolved — the migration adds it.

### ✅ P3-08 — Dunning (committed in `b4b6464d`)

`DunningService`, `DunningWorker` (`dunning.worker.ts`), `FINANCE_DUNNING_ATTEMPTS` via `…269`, `dunning.service.spec.ts`, `dunning.worker.spec.ts`, and `DUNNING: 24h/50` in `worker-config.ts`.

❌ **No dunning HTTP endpoints** — no controller anywhere references dunning. The staff-facing controls §15 Q14(d) lists as out-of-backlog-scope are correspondingly absent, which is self-consistent, but Q14(a) (which component owns the max-attempts counter) and Q14(b) (exponential vs. fixed `[1, 3, 7]` schedule) are not recorded as ruled.

### ✅ P3-09 — Recurring Billing / Renewal (committed in `e16c1118`, still partial)

The path §12 called "missing" now exists — `MembershipsService.renew()`, `renewDueMemberships()` and `renewOne()`, with `memberships.service.spec.ts` updated, and the invoice generated inside the membership transaction per §13. **Committed 2026-09-28 in `e16c1118`.** That commit is what closed the gap this line used to record: measured against the pre-`e16c1118` HEAD, `git show HEAD:src/memberships/services/memberships.service.ts | grep -n renew` returned exactly **one** hit — the `renewal_date` field assignment at line 398 — so HEAD then had no renewal logic at all. The same probe now returns the full renewal implementation, so the "HEAD has no renewal logic" clause is dated to the pre-commit tree.

❌ **No HTTP route.** All four membership controller files contain **0** occurrences of `renew`: renewal is service/worker-only. If the acceptance criterion requires an operator-triggered renewal, that API surface is missing.

### ⚠️ P3-10 — Storage Configuration (config shipped 2026-10-01; key builders deferred)

All three §10 gaps are still open, verified directly *(superseded 2026-10-01 for gaps #1 and #3 — `@Global()` `b71decf3`, `S3_LOCAL_ROOT`/`S3_DOCUMENTS_BUCKET`/`AWS_REGION` `387f706c`, `uploads/` ignored `a38bead9`; gap #2, the non-document key builders, remains and is deferred by owner scope)*:

| # | Gap | Evidence |
|---|-----|----------|
| 1 | `S3Module` not globally available | `s3.module.ts:6` is `exports: [S3Service]` with **no** `@Global()`; no `SharedModule` exists |
| 2 | `buildKey()` hard-coded to member documents | the only `buildKey` definition is `s3.service.ts:98`; the sole caller is `members/services/documents.service.ts:50`. No `buildCrmAttachmentKey()` / `buildInventoryImageKey()` |
| 3 | No S3 env documentation | `.env.example` has **0** matches for `S3_`, `AWS_REGION` or `DOCUMENTS_BUCKET` |

§10 explicitly classifies this as *"not a critical-path blocker … schedule opportunistically"*, so its absence does not block P3-05/P3-06.

⚠️ Worth flagging for the record, since P3-05 added lot expiry and P3-06 added lead attachments are the first non-document binary use cases the plan anticipated: gap #2 is now the binding constraint rather than a hypothetical one. Uploading an inventory item image or a CRM attachment would today be written under a member-document key prefix.

### ✅ P3-11 — Commission Clawback (committed in `823c00d5`)

`TrainerCommissionStatus.CLAWED_BACK` is **already committed** (`git show HEAD:…enum.ts` line 13) — it was pre-deployed for the Phase 3 flow by design, as the enum's own docstring explains. The diff adds `PAID` and rewrites the docstring to describe the new P3-11 transition. `TRAINER_COMMISSION_CLAWED_BACK: 'TrainerCommissionClawedBack.v1'` and `TRAINER_COMMISSION_PAID: 'TrainerCommissionPaid.v1'` are added to `pt.constants.ts`, and the write is performed inside `PtEnrollmentsService.cancel()` in a single row-locked transaction that preserves the commission snapshot.

Pinned by `pt-enrollments.service.spec.ts`, including a test asserting cancellation and clawback writes stay exclusively in `PtEnrollmentsService`.

⚠️ Granularity is **all-or-nothing**, consistent with the one-row-per-enrollment unique index. §15 Q16 asks whether pro-rata partial clawback is wanted; it is not recorded as ruled, so all-or-nothing should be confirmed rather than assumed.

### ✅ P3-12 — Commission Payout (committed in `fa8c5212`)

`CommissionPayoutRun` / `CommissionPayoutItem` entities, `CommissionPayoutsService`, `CommissionPayoutsController` at `v1/pt/commission-payouts`:

```
POST  /v1/pt/commission-payouts            (pt:payout)
POST  /v1/pt/commission-payouts/:id/process (pt:payout)
GET   /v1/pt/commission-payouts/:id         (pt:read for detail)
```

Migrations `…270`/`…271`. This follows §15 Q15's **recommended option (a)** — a separate payout-run table pair — which preserves the Phase 2 invariant that `TrainerCommission` carries no `paid_at` / `paid_amount`.

### ✅ DEF-01 — `QueryMembershipPlanDto.is_active` inversion (**fixed in `3dee318a`**)

**Fixed in `3dee318a`.** `@Type(() => Boolean)` is gone: `query-membership-plan.dto.ts` now parses `is_active` with `@Transform(({ value }) => value === true || value === 'true')` (line 34) — the same form `QueryTaxRateDto.is_active` and `QueryInvoiceDto.outstanding_only` already use — and the regression spec `query-membership-plan.dto.spec.ts` named in the backlog now exists. `@Type(() => Boolean)` no longer appears anywhere in `src/`. As filed (`30fc54b2`, `889448c4`) the defect was live exactly as reproduced in §1.3, which remains the transcription of the state observed on 2026-09-25.


---

## 4. Cross-cutting findings

### 4.1 ⚠️ The green CI suite and the non-booting app are consistent

Typecheck, lint and 1069 tests all pass while `AppModule` cannot be constructed. That is not a contradiction to explain away — it is a coverage gap with a specific shape:

- No test compiles the real `AppModule`. Module specs (`finance.module.spec.ts`, `pt.module.spec.ts`, `memberships` equivalents) hand-assemble providers and `overrideProvider` the TypeORM connection, by explicit design ("because the registry's external dependencies … cannot be booted in a unit test").
- Hand-assembled provider lists are maintained by hand, so they **cannot** detect a missing `exports` entry in the real module. The spec asserts `PAYMENT_GATEWAY` is the *unavailable* gateway; it never constructs the Stripe adapter.
- Consequently both boot blockers were invisible to the entire gate suite, and a `nest build`/`tsc` pass cannot see them either, because they are runtime DI-resolution and SDK-constructor failures.

**Recommendation:** add one `app.module.spec.ts` that does `Test.createTestingModule({ imports: [AppModule] }).compile()` with `STRIPE_SECRET_KEY` unset, asserting it compiles. That single test would have caught both blockers. If booting the real TypeORM connection is a problem, asserting the *compile* step alone (without `init()`) is sufficient — that is exactly the probe used in §1.1.

### 4.2 ⚠️ `PT_EVENT_VERSION` changed `'1'` → `'v1'` — a silent behaviour change for zero gain

The diff also changes PT's envelope version:

```
-export const PT_EVENT_VERSION = '1';
+export const PT_EVENT_VERSION = 'v1';
```

I checked whether this is required by P3-11/P3-12. **It is not** — it is unrelated cleanup riding along inside this changeset. PT event *types* already carry the version in their name (`TrainerCommissionEarned.v1`), which is the documented PT convention, and `packages/contracts/src/events/pt.events.ts` says so explicitly: *"PT events keep the module's existing version-in-the-name convention."*

The outbox envelope's version is a **routing key**, not decoration: `outbox.poller.ts:94` dispatches on `getHandlers(envelope.eventType, envelope.eventVersion)`, and the handler registry is keyed on the pair. So the envelope version is part of the dispatch address.

⚠️ **Consequences, stated with their confidence level:**
- Every PT outbox *row already written* to any environment under version `'1'` now carries a version that no longer matches the constant. For already-persisted rows this is **only a payload string** — the dispatcher reads the version from the stored JSON, so old rows keep dispatching under `'1'`. I found **no** PT handlers registered anywhere (grep for the three PT event names outside `pt.constants.ts` and specs returns only a docstring comment), so today nothing actually keys off it and the change is currently inert. **The risk is latent, not live.**
- It is nonetheless a wire-format change to events that are part of the documented contract, made in the same commit range as a def-capability change, with no `event-contracts.md` update and no ruling recorded. §253 of `docs/event-contracts.md` documents `TrainerCommissionEarned.v1` without stating an envelope version.

**Recommendation:** either revert to `'1'` to keep P3-11/P3-12 minimal, or record it as an intentional ruling (and align `docs/event-contracts.md`). Do not leave it as incidental churn. Note that `'v1'` matches the other Phase 3 modules (`FINANCE_EVENT_VERSION`, `ATTENDANCE_EVENT_VERSION`, `LOYALTY_EVENT_VERSION`, `INVENTORY_EVENT_VERSION`, `CRM_EVENT_VERSION`, `WORKOUT_EVENT_VERSION` are all `'v1'`), so the *new* value is the more consistent one — which makes this a defensible cleanup that was simply never declared.

### 4.3 ✅ RESOLVED — RLS formally deferred (Q11 ruled)

> **RULING (2026-09-26): RLS will not be implemented at this time.** Tenant isolation remains enforced at the **application layer only** — explicit `organization_id` predicates in every repository query, resolved through `TenantContextService` — which was confirmed to be applied consistently across every checked service with **zero exceptions found**.
>
> RLS was evaluated and deferred because **no per-request connection affinity exists in the current architecture**: TypeORM's connection-pooled, non-request-scoped design means `SET LOCAL` cannot reliably propagate the session GUC that the policies depend on without a broader request-lifecycle change (connection pinning + re-issuing the GUC at every transaction boundary). Implementing it properly was estimated at **6–11 weeks**, which is disproportionate to the risk given the consistent existing predicate-based enforcement.
>
> `docs/database-plan.md` has been amended accordingly: its "Row-Level Security (RLS) Policies" section is now **"Tenant Isolation — Application-Layer Enforcement (RLS Deferred)"**, which states the decision, the rationale, the consequences (no database-level backstop), and the revisit triggers. The mandate and its worked SQL example are retained there as superseded history. The backlog (`P0-03`), `implementation-roadmap.md`, `domain-map.md` and `COMPLETION_SUMMARY.md` were updated so no document still asserts RLS as an outstanding requirement.
>
> **The finding below is preserved as observed on the date of this report; its recommendation has been answered.**

This is a documented-but-unmet requirement, not merely an absence of a feature nobody asked for. `docs/database-plan.md` has a §**Row-Level Security (RLS) Policies** section that says:

> Enable RLS on all tenant-scoped tables and create policies that restrict rows to the current tenant context.
> … Similar policies for branches, users, memberships, finance, etc.

with a worked example using `current_setting('app.current_organization_id')::uuid`.

Against that requirement:

| Check | Result |
|-------|--------|
| `ENABLE ROW LEVEL SECURITY` in `src/`, `packages/`, `apps/` | **0 matches** |
| `CREATE POLICY` in `src/`, `packages/`, `apps/` | **0 matches** |
| Same strings anywhere in `docs/` | 2 matches, both **inside the plan's own example** (`database-plan.md:801-802`) — no implementation, no migration |
| `app.current_organization_id` set anywhere (including `set_config` / `SET LOCAL`) | **0 matches** |
| `pg_advisory_xact_lock` (the renewal-lock technique the same document's concurrency table specifies) | **0 matches** |

So tenant isolation rests **entirely** on every query carrying its organization predicate — the application-level scoping `.clinerules` mandates. There is no database-level backstop, and the session GUC the plan's policy design depends on is never populated, so those policies could not function today even if they were created.

This has two implications worth separating:

1. **It is pre-existing, not a Phase 3 regression.** Every earlier phase shipped the same way. `.clinerules` explicitly forbids inventing a parallel authorization or tenancy system, so *not* adding RLS opportunistically was arguably the correct call.
2. **But Phase 3 materially expands what is unprotected.** P3-05's six inventory entities, P3-06/P3-07's eight CRM entities, and P3-03's webhook/payment-method/dunning tables add 17+ tenant-scoped tables, several holding payment-adjacent data (payment methods, webhook payloads). Combined with the §4.1 finding that the gates cannot boot the app, this is the weakest-covered surface the project has had.

**Recommendation:** raise `database-plan.md`'s RLS section as an explicit, ruled decision — either implement the policies plus the session-GUC plumbing (a cross-cutting migration and a TypeORM transaction hook), or amend the plan to record that app-level scoping is the accepted, permanent mechanism. Leaving a plan document asserting a requirement that eleven phases of code have all skipped is the kind of divergence that misleads the next reader.

> **ANSWERED (2026-09-26) — the second option was taken.** RLS is formally deferred and `database-plan.md` now records app-level scoping as the accepted permanent mechanism; see the ruling banner at the top of §4.3.

⚠️ Likewise `database-plan.md`'s concurrency table specifies an advisory lock for membership renewal; `renew()` is implemented without one. If concurrent renewal of the same membership is possible, the plan's own prescribed technique is unimplemented. This is **UNVERIFIED** as a live defect — I did not test concurrent renewal — but the divergence from the plan is confirmed by grep.


### 4.4 ✅ Migrations replay cleanly from zero

45 migrations applied to an empty database with `RUN_EXIT=0`, and `migration:show` reported all 45 as applied (`SHOW_EXIT=0`). As measured on 2026-09-26 that run included the 12 Phase 3 migrations then still uncommitted — all 45 are committed as of 2026-09-28 (see §0) — and it was previously a real defect — the fix is visible in the log: `2d08e53b fix(migrations): pin 253's view era so fresh migration:run works` and `213956cc fix(migrations): move ledger-view SQL builders out of the migration glob`.


---

## 5. Test-coverage gaps (the "NO-SPEC" list)

Every item below is a Phase 3 artifact with **no sibling spec**:

| Artifact | Owner item |
|----------|-----------|
| `src/memberships/entities/membership-discount.entity.ts` | P3-04b |
| `src/memberships/dto/create-membership-discount.dto.ts` | P3-04b |
| `src/finance/entities/invoice-discount.entity.ts` | P3-04b |
| `src/inventory/**` — the six entities, `inventory.dto.ts`, `inventory.constants.ts`, `inventory.module.ts` (the **service and controller both have specs**) | P3-05 |
| `packages/contracts/src/events/crm.events.ts`, `inventory.events.ts` (both now **tracked** — committed in `08978034`) and `pt.events.ts` (since committed in `fa8c5212`), plus the modified `finance.events.ts` — note that **no** contract event file anywhere has a spec, so this is a repo-wide convention rather than a Phase 3 gap | P3-05/P3-06/P3-11 |
| `src/finance/entities/webhook-event.entity.ts`, `payment-method.entity.ts`, `dunning-attempt.entity.ts` | P3-03/P3-08 |
| `src/finance/dto/attach-payment-method.dto.ts` | P3-03 |
| `src/pt/dto/cancel-pt-enrollment.dto.ts`, `create-commission-payout.dto.ts` | P3-11/P3-12 |
| `src/migrations/__specs__/` — the 12 new migrations are largely unspecced, **except** `…270-CreatePtCommissionPayoutTables.spec.ts` and `…271-ProvisionPtPayoutPermission.spec.ts`, which do exist | P3-03/P3-04b/P3-05/P3-06/P3-07/P3-08 |

What **does** exist, so the gap is bounded rather than total: P3-05 has `inventory.service.spec.ts` **and** `inventory.controller.spec.ts`; P3-06 has `crm.service.spec.ts`, `crm.controller.spec.ts`, `follow-ups.service.spec.ts`, `follow-ups.controller.spec.ts`, `sla.service.spec.ts`, `sla.controller.spec.ts` and `crm.constants.spec.ts`; P3-12 has `commission-payouts.service.spec.ts` and a controller spec; P3-08 has two specs; P3-03 has three; P3-11 has the enrollments spec.

So the pattern is consistent and deliberate: **services, controllers and constants are covered; entities, DTOs and barrel/module files are not.** That is a reasonable convention — entities and DTOs are declarative — but it is worth recording explicitly, because it is exactly the convention that let the unruled dunning/renewal semantics pass review. *(Corrected 2026-09-27: this sentence also cited “P3-04b's configurable-ordering gap”; there is no such gap — the plan §15 Q9(a) ruling of 2026-09-27 fixes the order discount-before-tax by design, and it is pinned by `invoices.service.spec.ts:330`.)* The one substantive exception is that no spec pins `inventory-lot` expiry, which is a behaviour, not a declaration.

✅ **Corrected 2026-09-27 — this absence was wrongly reported:** the **combined tax + discount** scenario spec *does* exist. `invoices.service.spec.ts:330` asserts that tax is computed on the discounted amount, not the original membership price, with the no-active-discount regression case at `:352`. The other half is pinned too: `src/memberships/services/memberships.service.spec.ts` covers the `discounts` cases (cross-org rejection `:380`, lock-before-check `:400`, the >100 % guard `:419`, the 100 % boundary `:434`) and the real sale path that persists the discounted totals plus the `InvoiceDiscount` snapshot `:543`. The ordering is now **ruled fixed** (§15 Q9(a), 2026-09-27), so those specs are what pin the ruled order — not, as this line said, “the shape of one ternary in `invoices.service.ts`”.

---

## 6. Open questions requiring a ruling

| # | Question | Where it bites |
|---|----------|----------------|
| Q1 | **Is `HEAD` the deliverable baseline, or must the 92 uncommitted files be committed?** *(As posed 2026-09-25; **CLOSED 2026-09-28** — the feature files were committed in `021dc160` and `e16c1118`; the last seven non-source paths also landed — the 3 contract/doc artifacts in `08978034`, the 4 Phase-3 docs in `bd19fca7` — so **0 paths remain uncommitted** (`git ls-files` resolves all seven; `git status --porcelain` is empty). See §0.)* | Determines whether Phase 3 is "4 items done" or "12 items done". Everything else is downstream. |
| Q2 | If committed, is the P3-03 boot blocker fixed first? | Shipping the working tree as-is produces a non-booting `main`. |
| Q3 | Are `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` to be documented in `.env.example`? | P3-03 is unconfigurable and undiscoverable today. |
| Q4 | Should `GatewayWebhookService` adopt the adapter's `isConfigured` guard? | BLOCKER-2: without it, an optional credential breaks the whole app. |
| Q5 | Is discount-before-tax permanently correct, or is a configurable ordering still required by P3-04b's acceptance criteria? | **RULED (2026-09-27): discount-before-tax is permanent** — configurable ordering will not be built (no known customer or jurisdiction requirement for the alternative ordering; revisit if one emerges). The artifact at fault was the criterion, not the code: it is now relaxed to “discounts applied **before** tax” in `phase3-scoping-plan.md` §4 and `docs/task-backlog.md` P3-04b. No code change — the implementation already matches, and `invoices.service.spec.ts:330` pins it. No longer blocking |
| Q6 | Confirm all-or-nothing clawback (Q16), or specify pro-rata. | P3-11 semantics. |
| Q7 | Is `PT_EVENT_VERSION = 'v1'` an intentional ruling or incidental churn? | **Intentional — documented in commit `e2d062c2` (2026-09-26)**, whose message states the rationale: `PT_EVENT_VERSION` "was the last event version constant still declaring `'1'`. Finance, CRM, inventory, memberships, attendance and loyalty all declare `'v1'` (FINANCE_EVENT_VERSION, CRM_EVENT_VERSION, INVENTORY_EVENT_VERSION, MEMBERSHIP_EVENT_VERSION, ATTENDANCE_EVENT_VERSION, LOYALTY_EVENT_VERSION), so PT was the outlier rather than a deliberate exception." Not incidental churn. The commit also records that it is inert at runtime — the dispatcher reads the version from the stored envelope, so rows already written under `'1'` keep dispatching under `'1'`, and no PT event handler is registered. Recorded from the commit message, **not** from an owner ruling: plan §15 carries no `Decision` line for it |
| Q8 | Is an operator-triggered renewal route required for P3-09's acceptance criteria? | Renewal is currently service/worker-only. |
| Q9 | What is the ruling on Q14(a)/(b) for dunning (attempt counter owner; fixed vs. exponential schedule)? | Implementation is unruled. |
| Q10 | Does P3-10's S3 gap now need priority, given P3-05/P3-06 introduced the first non-document attachments? | §10 called it opportunistic; its premise has changed. |
| Q11 | Definitive position on RLS — implement `database-plan.md`'s policies, or amend the plan to accept app-level scoping permanently? | **RULED (2026-09-26): RLS formally deferred.** `database-plan.md` amended to record application-layer scoping as the accepted permanent mechanism (no per-request connection affinity for the session GUC; 6–11 week estimate); backlog/roadmap/domain-map/completion-summary updated to match. No longer blocking — see §4.3 |

---

## 7. Summary

| Status | Items |
|--------|-------|
| ✅ Complete (committed on `main` / `origin/main` @ `c7f84c08`) | **P3-01, P3-02, P3-04** |
| ✅ Complete (fixed in `3dee318a`) | **DEF-01** |
| ✅ Complete (committed) — as of 2026-09-28 | **P3-03** (`b4b6464d`) · **P3-04b** (`021dc160`) · **P3-05** (`b4b6464d`; still partial — 4 endpoints + 2 workers absent) · **P3-06** (`b4b6464d`) · **P3-07** (`b4b6464d`) · **P3-08** (`b4b6464d`) · **P3-09** (`e16c1118`; still partial — no HTTP route) · **P3-11** (`823c00d5`) · **P3-12** (`fa8c5212`) |
| ⚠️ Partial (config shipped 2026-10-01 — `b71decf3`/`387f706c`/`a38bead9`; key builders deferred) | **P3-10** |

**Frontend:** Phase 3 remains **API-only** — none of the five `implementation-roadmap.md` §Phase 3 "Frontend Changes" deliverables (inventory management UI, CRM pipeline and lead management, advanced financial reports, trainer commission statements, refund/credit-note processing UI) exists, and `apps/web` contains no Phase 3 surface at all. The frontend that *does* exist (19 routes, Phase 0–2 scope: auth, shell, members, memberships, plans, payments, check-in, branches, organizations, settings, AI) is inventoried in `phase3-completion-checklist-report.md` §7.

**The headline is not the feature status — it is the commit boundary.** *(Dated 2026-09-25; superseded 2026-09-28 — see §0.)* As recorded then: twelve of the thirteen Phase 3 items were implemented to some degree, but **only three were committed**, and the uncommitted supermajority contained a defect that prevented the application from starting. Every automated gate was green on that broken tree, because the gates could not boot the application by construction and the module specs hand-assemble their provider lists.

**That boundary no longer exists.** As of `021dc160` every Phase 3 item except P3-10 is committed, and both boot blockers were resolved in `b4b6464d`: `src/finance/services/stripe-payment-gateway.adapter.ts:14-18` now reads the key into `isConfigured` and constructs `new Stripe(key)` only when the key is present (`if (!this.stripe) return this.unavailable()`), and `FinanceModule` exports `WebhookEventProcessor` (`src/finance/finance.module.ts:133`). `src/app.boot.spec.ts` — the AppModule-compiles-with-`STRIPE_SECRET_KEY`-unset spec this report recommended in step 3 below — is committed in that same commit. The weaker half of the point still stands: green gates never proved the tree could boot, so "all gates green" should still not be read as "the application runs".

**Ordered recommendation:**

*(Added 2026-09-28.)* Steps 1–3 below are **addressed** in committed code — `b4b6464d` guards the Stripe construction (`src/finance/services/stripe-payment-gateway.adapter.ts:14-18`) and exports `WebhookEventProcessor` (`src/finance/finance.module.ts:133`), and `src/app.boot.spec.ts`, which asserts the real `AppModule` compiles with `STRIPE_SECRET_KEY` unset, is committed in that same commit. That spec's own pass/fail has **not** been re-run in this session, so "addressed in code" is not the same as "observed green". Step 4 is **done** — `287faeec` documented the two Stripe keys (`grep -ci stripe .env.example` → `6`). Step 5's commit decision is closed; its rulings are not. Steps 1–4 are left below exactly as written, for the record.

1. **Fix BLOCKER-2 first** (guard `new Stripe(...)` behind the configured check) — it converts a fatal failure into a graceful degradation. It is a small, contained change.
2. **Fix BLOCKER-1** (export `WebhookEventProcessor`, `GatewayWebhookService`, `StripePaymentGatewayAdapter` from `FinanceModule`, or restructure the worker's dependency).
3. **Add `app.module.spec.ts`** asserting `AppModule` compiles with `STRIPE_SECRET_KEY` unset, so neither regression can recur.
4. **Document the two Stripe keys** in `.env.example`.
5. ~~**Then** resolve the commit decision (Q1) and commit~~ — **done 2026-09-28: the membership half landed as `021dc160` and the renewal half as `e16c1118`.** What remains of this step is the **rulings, not the commit** — **P3-11** clawback granularity (§15 Q16), the **dunning** rulings (Q14(a) which component owns the max-attempts counter, Q14(b) exponential vs. fixed `[1, 3, 7]` schedule) and the **renewal** surface (operator route vs. worker-only). The P3-04b discount-ordering ruling already landed **2026-09-27** (plan §15 Q9(a): fixed discount-before-tax, not configurable).
6. ~~**Separately**, settle the RLS divergence in §4.3 by ruling on Q11~~ — **done (2026-09-26): RLS formally deferred; `database-plan.md` and the backlog/roadmap/domain-map now record application-layer scoping as the accepted mechanism (§4.3).**

**Verification honesty note:** the four gates and the fresh-DB migration replay are reported from captured command output and are trustworthy. The **boot-blocker findings are reproduced**, but the probe harness was a temporary `ts-node` script that has since been deleted, and the worktree used for the HEAD baseline check was removed — so re-verification requires re-running §1.1's three-variant probe. Nothing in this report is based on a prior session's summary; every claim was re-derived against the repository during this run.

**Cleanup:** both temporary worktrees removed (`git worktree list` shows only the three long-lived ones), no `tmp-*` or scratch files remain in the repository, and the temporary `gym_p3_final_*` database was dropped. Logs remain under `/tmp/` (`boo2.log`, `boo3.log`, `mig-final.log`, `v4-*.log`, `v5-webtsc.log`, and the `d-*.diff` files written this run) in case the raw evidence is wanted.

