# Phase 3 Status Report — Verified

**Date:** 2026-09-25
**Scope:** `docs/phase3-scoping-plan.md` (§1–§15) and `docs/task-backlog.md` (P3-01 … P3-12, incl. P3-04b, and DEF-01)
**Method:** read-only inspection of the working tree plus command output captured to files. Every claim below is backed by a command in §1 or §2; anything not reproduced is marked **UNVERIFIED**.

**Legend:** ✅ complete · 🚧 partial · ❌ missing · ⚠️ risk/observation · 📋 not in Phase 3 scope

---

## 1. Verification evidence

All four gates were run on the **working tree** (which includes uncommitted Phase 3 work) and green:

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

This isolates **two independent, uncommitted boot blockers** (detail in §4):

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

So the boot breakage is introduced **entirely by uncommitted work** — it is not a defect in the committed branch.

### 1.3 DEF-01 reproduced

```
is_active=true  -> typeof=boolean value=true  errors=0
is_active=false -> typeof=boolean value=true  errors=0
is_active=0     -> typeof=boolean value=true  errors=0
is_active=1     -> typeof=boolean value=true  errors=0
is_active=FALSE -> typeof=boolean value=true  errors=0
```

`?is_active=false` filters for **active** plans and raises no validation error, exactly as the backlog's DEF-01 entry describes.

---

## 2. Repository state and the commit boundary

This is the single most important finding in the report: **the working tree contains far more Phase 3 work than has been committed.**

| Ref | Commit | Relation |
|-----|--------|----------|
| local `main` | `c7f84c08` | `docs(finance): mark the refundedTotal regression test as written, not pending` |
| `origin/main` | `c7f84c08` | identical to local `main` — in sync |
| `phase-4` worktree | `8ca91e4e` | contains `main` history |
| `phase-6` worktree | `bbf73176` | **contains `main`** (`git merge-base --is-ancestor c7f84c08 bbf73176` → true); `origin/phase-6: ahead 9` |

`bbf73176` is **not** an ancestor of `main`. `55a22b9b` is `Merge origin/main (Phase 3 finance) into phase-6 (Phase 6 reports)` and is contained by `phase-6` / `origin/phase-6` only.

Working tree vs HEAD:

```
MODIFIED (tracked): 41
UNTRACKED:          51
TOTAL:              92
```

**Tracked on `main` (committed):** P3-01, P3-02, P3-04. Migrations run through `1788965263259`.

**Untracked (uncommitted):** everything else — 12 migrations `1788965263260`…`1788965263271`, all of P3-03, P3-04b, P3-05, P3-06, P3-07, P3-08, P3-09, P3-11, P3-12, plus the new worker and contract files.

`git grep` on `HEAD` for `StripePaymentGatewayAdapter|GatewayWebhook|WebhookEventProcessor|WebhookEventWorker|DunningWorker|CrmFollowUpsWorker|CrmSlaMonitorWorker` returns **nothing**, and `git ls-tree -r HEAD` has **zero** entries under `src/inventory/` or `src/crm/`.

⚠️ **Consequence:** the green CI gates in §1 validate the uncommitted working tree. Anyone who clones `origin/main` gets only §3's ✅ items; anyone who checks out `main` as-is gets a coherent, bootable, but **much smaller** Phase 3. The boot blockers in §1.1 exist only in the uncommitted state, so CI (which runs typecheck, lint, web typecheck and jest — see `.github/workflows/ci.yml`) has never been in a position to catch them.

**Commit boundary, per artifact:**

```
TRACKED   …259-AddRefundsAndCreditNotesToFinanceLedgerViews.ts   <- last committed migration
UNTRACKED 1788965263260-AddPaymentGatewayAndWebhookEvents.ts
UNTRACKED 1788965263261-CreateFinancePaymentMethods.ts
UNTRACKED 1788965263262-CreateMembershipDiscounts.ts
UNTRACKED 1788965263263-CreateInvoiceDiscountSnapshots.ts
UNTRACKED 1788965263264-CreateInventorySchema.ts
UNTRACKED 1788965263265-ProvisionInventoryPermissions.ts
UNTRACKED 1788965263266-CreateCrmLeadManagement.ts
UNTRACKED 1788965263267-ProvisionCrmPermissions.ts
UNTRACKED 1788965263268-CreateCrmFollowUpsAndSla.ts
UNTRACKED 1788965263269-CreateFinanceDunningAttempts.ts
UNTRACKED 1788965263270-CreatePtCommissionPayoutTables.ts
UNTRACKED 1788965263271-ProvisionPtPayoutPermission.ts
```

Note also that `finance.module.spec.ts` — a **tracked** file — has been modified in the working tree to reference `WebhookEvent`, `PaymentMethod`, `PaymentMethodsService` and `PaymentMethodsController`, so the committed copy of that spec does not match the committed copy of `finance.module.ts`. At the same time, a grep of that spec for `GatewayWebhookService`, `StripePaymentGatewayAdapter`, `WebhookEventProcessor` and `DunningService` returns **0** matches for every one of them: the P3-03 providers are wired into the module but are **not covered by the module-wiring spec**, which is precisely why the missing `exports` in §1.1 went unnoticed. That spec only asserts `PAYMENT_GATEWAY` resolves to `UnavailablePaymentGateway` with `isConfigured === false` — it never loads the Stripe adapter at all.


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

### 🚧 P3-03 — Payment Gateway Integration (uncommitted, **does not boot**)

Artifacts present but untracked: `stripe-payment-gateway.adapter.ts`, `gateway-webhook.service.ts`, `webhook-event.processor.ts`, `webhook-event.worker.ts`, `gateway-webhook.controller.ts` (`POST v1/webhooks/payment-gateway`), `payment-methods.controller.ts` (`POST :id/payment-methods`), migrations `…260`/`…261`, plus specs for the adapter, the processor, payment-methods and dunning.

| Criterion | State |
|-----------|-------|
| Payments processed via gateway | 🚧 adapter written; `PAYMENT_GATEWAY` still resolves to `UnavailablePaymentGateway` when no key is configured |
| Webhooks handled idempotently | 🚧 `WebhookEvent` + `provider_event_id` lookup implemented; **unreachable** because the app cannot boot |
| Failed payments retry appropriately | 🚧 retry path rewired; tests green |
| Refunds processed via gateway | 🚧 `RefundsService.applyGatewayOutcome()` + processor wiring present; **unreachable** |

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

### 🚧 P3-04b — Membership Discounts (uncommitted)

⚠️ **This item straddles the commit boundary, and the split matters.** HEAD's `invoices.service.ts` has **zero** matches for `discount` (`git show HEAD:src/finance/services/invoices.service.ts | grep -ci discount` → `0`), so the committed service has **no discount handling at all**. The tax-aware discount math and the `InvoiceDiscount` snapshot are therefore **uncommitted edits to a tracked file** — the file is tracked, the feature is not. Likewise `memberships.service.ts` and `memberships.controller.ts` are tracked files whose discount work is uncommitted.

The genuinely **untracked** artifacts are the schema and route half: `membership-discount.entity.ts`, `create-membership-discount.dto.ts`, migration `…262` (`MEMBERSHIP_MEMBERSHIP_DISCOUNTS`), migration `…263` (`FINANCE_INVOICE_DISCOUNTS`), and the `POST /v1/memberships/:id/discount` route (`memberships.controller.ts:69`, gated on existing `membership:update`).

So the tracked/untracked distinction does **not** separate "committed" from "uncommitted" here: **nothing about P3-04b is committed.** `MEMBERSHIP_MEMBERSHIP_DISCOUNTS` — the table the backlog recorded as absent ("verified 2026-09-17") — exists in the working tree only.

The committed design it builds on is what makes the criterion below reachable at all:


```ts
const discountAmount = input.discount
  ? input.discount.discount_type === 'percentage'
    ? Math.min(price, price * Number(input.discount.amount) / 100)
    : Math.min(price, Number(input.discount.amount))
  : 0;
const netAmount = toMoney(price - discountAmount);
```

❌ **The acceptance criterion "discounts applied before/after tax as configured" is NOT met.** There is no configuration surface: a repo-wide grep for `discount_before_tax|discount_order|discountAfterTax|discount_after_tax|beforeTax` across `src/` and `packages/` returns **zero** matches. The implementation is **hard-coded discount-before-tax** — the price is reduced first, then tax is computed on the net amount. That is exactly the forward-compatible shape §15 Q9(a) deferred, but the *configurable* ordering the backlog demands is absent.

⚠️ The ownership direction of §15 Q8 (`Membership owns the definition; Finance applies it`) **is** satisfied in practice — the definition lives in `src/memberships/`, application in `src/finance/` — though §15 still records the ruling as open pending P3-04b.

❌ No combined tax+discount scenario spec, and neither `membership-discount.entity.ts` nor `create-membership-discount.dto.ts` has a sibling spec.

### 🚧 P3-05 — Inventory Management (uncommitted, partial)

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

### 🚧 P3-06 — CRM Lead Management (uncommitted)

`src/crm/` module with entities `lead`, `lead-activity`, `lead-source`, `lead-stage`, `conversion`; migrations `…266`/`…267`; `crm.service.spec.ts`. Routes on `@Controller('v1/leads')`: `GET`, `GET pipeline`, `GET :id`, `POST`, `PATCH :id`, `POST :id/activities`, `POST :id/convert`, `POST :id/follow-ups`.

Conversion is guarded against double-conversion both by status/`member_id` and by an existing `CRM_CONVERSIONS` row, and it creates the member through the members module rather than duplicating member writes.

❌ `packages/contracts/src/events/crm.events.ts` has no sibling spec.


### 🚧 P3-07 — Follow-ups and SLAs (uncommitted)

`CRM_FOLLOW_UPS` (+ SLA columns), `CRM_SLA_POLICIES` and `CRM_SLA_BREACHES` (entities `follow-up`, `sla-policy`, `sla-breach`) via migration `…268`; `FollowUpsService`, `SlaService`. Routes match the backlog:

```
@Controller('v1/follow-ups')  GET due          POST :id/complete
@Controller('v1/sla')         GET reports      GET policies
                              POST policies    PATCH policies/:id
```

Both requested workers exist **with specs**: `crm-follow-ups.worker.ts` and `crm-sla-monitor.worker.ts`, with intervals and batch sizes added to `worker-config.ts` (`CRM_FOLLOW_UPS: 30m/100`, `CRM_SLA_MONITOR: 15m/100`) — the monitor runs twice as often as the scheduler, with the reasoning recorded in a comment.

Escalation runs in the executed suite (captured output): `Recorded 3 overdue follow-up breach(es) and 1 first-response breach(es)` and `Escalated 2 SLA breach(es)`. §9's ⚠️ note that `CRM_FOLLOW_UPS` lacked `created_at` in the ERD is resolved — the migration adds it.

### 🚧 P3-08 — Dunning (uncommitted)

`DunningService`, `DunningWorker` (`dunning.worker.ts`), `FINANCE_DUNNING_ATTEMPTS` via `…269`, `dunning.service.spec.ts`, `dunning.worker.spec.ts`, and `DUNNING: 24h/50` in `worker-config.ts`.

❌ **No dunning HTTP endpoints** — no controller anywhere references dunning. The staff-facing controls §15 Q14(d) lists as out-of-backlog-scope are correspondingly absent, which is self-consistent, but Q14(a) (which component owns the max-attempts counter) and Q14(b) (exponential vs. fixed `[1, 3, 7]` schedule) are not recorded as ruled.

### 🚧 P3-09 — Recurring Billing / Renewal (uncommitted, partial)

The path §12 called "missing" now exists — `MembershipsService.renew()`, `renewDueMemberships()` and `renewOne()`, with `memberships.service.spec.ts` updated, and the invoice generated inside the membership transaction per §13. `git show HEAD:src/memberships/services/memberships.service.ts | grep -n renew` returns exactly **one** hit, and it is the `renewal_date` field assignment at line 398 — so HEAD has no renewal logic at all.

❌ **No HTTP route.** All four membership controller files contain **0** occurrences of `renew`: renewal is service/worker-only. If the acceptance criterion requires an operator-triggered renewal, that API surface is missing.

### ❌ P3-10 — Storage Configuration (not started)

All three §10 gaps are still open, verified directly:

| # | Gap | Evidence |
|---|-----|----------|
| 1 | `S3Module` not globally available | `s3.module.ts:6` is `exports: [S3Service]` with **no** `@Global()`; no `SharedModule` exists |
| 2 | `buildKey()` hard-coded to member documents | the only `buildKey` definition is `s3.service.ts:98`; the sole caller is `members/services/documents.service.ts:50`. No `buildCrmAttachmentKey()` / `buildInventoryImageKey()` |
| 3 | No S3 env documentation | `.env.example` has **0** matches for `S3_`, `AWS_REGION` or `DOCUMENTS_BUCKET` |

§10 explicitly classifies this as *"not a critical-path blocker … schedule opportunistically"*, so its absence does not block P3-05/P3-06.

⚠️ Worth flagging for the record, since P3-05 added lot expiry and P3-06 added lead attachments are the first non-document binary use cases the plan anticipated: gap #2 is now the binding constraint rather than a hypothetical one. Uploading an inventory item image or a CRM attachment would today be written under a member-document key prefix.

### 🚧 P3-11 — Commission Clawback (uncommitted)

`TrainerCommissionStatus.CLAWED_BACK` is **already committed** (`git show HEAD:…enum.ts` line 13) — it was pre-deployed for the Phase 3 flow by design, as the enum's own docstring explains. The diff adds `PAID` and rewrites the docstring to describe the new P3-11 transition. `TRAINER_COMMISSION_CLAWED_BACK: 'TrainerCommissionClawedBack.v1'` and `TRAINER_COMMISSION_PAID: 'TrainerCommissionPaid.v1'` are added to `pt.constants.ts`, and the write is performed inside `PtEnrollmentsService.cancel()` in a single row-locked transaction that preserves the commission snapshot.

Pinned by `pt-enrollments.service.spec.ts`, including a test asserting cancellation and clawback writes stay exclusively in `PtEnrollmentsService`.

⚠️ Granularity is **all-or-nothing**, consistent with the one-row-per-enrollment unique index. §15 Q16 asks whether pro-rata partial clawback is wanted; it is not recorded as ruled, so all-or-nothing should be confirmed rather than assumed.

### 🚧 P3-12 — Commission Payout (uncommitted)

`CommissionPayoutRun` / `CommissionPayoutItem` entities, `CommissionPayoutsService`, `CommissionPayoutsController` at `v1/pt/commission-payouts`:

```
POST  /v1/pt/commission-payouts            (pt:payout)
POST  /v1/pt/commission-payouts/:id/process (pt:payout)
GET   /v1/pt/commission-payouts/:id         (pt:read for detail)
```

Migrations `…270`/`…271`. This follows §15 Q15's **recommended option (a)** — a separate payout-run table pair — which preserves the Phase 2 invariant that `TrainerCommission` carries no `paid_at` / `paid_amount`.

### ❌ DEF-01 — `QueryMembershipPlanDto.is_active` inversion (**not fixed**)

`@Type(() => Boolean)` is still present at `query-membership-plan.dto.ts:18`, and the regression spec `query-membership-plan.dto.spec.ts` named in the backlog **does not exist**. Behaviour reproduced in §1.3: every one of `true`, `false`, `0`, `1`, `FALSE` becomes `true` with `errors=0`. The defect is still live exactly as filed (`30fc54b2`, `889448c4`).


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

### 4.3 ⚠️ RLS is mandated by `docs/database-plan.md` but is **not implemented** anywhere

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

⚠️ Likewise `database-plan.md`'s concurrency table specifies an advisory lock for membership renewal; `renew()` is implemented without one. If concurrent renewal of the same membership is possible, the plan's own prescribed technique is unimplemented. This is **UNVERIFIED** as a live defect — I did not test concurrent renewal — but the divergence from the plan is confirmed by grep.


### 4.4 ✅ Migrations replay cleanly from zero

45 migrations applied to an empty database with `RUN_EXIT=0`, and `migration:show` reported all 45 as applied (`SHOW_EXIT=0`). This includes the 12 uncommitted Phase 3 migrations and was previously a real defect — the fix is visible in the log: `2d08e53b fix(migrations): pin 253's view era so fresh migration:run works` and `213956cc fix(migrations): move ledger-view SQL builders out of the migration glob`.


---

## 5. Test-coverage gaps (the "NO-SPEC" list)

Every item below is a Phase 3 artifact with **no sibling spec**:

| Artifact | Owner item |
|----------|-----------|
| `src/memberships/entities/membership-discount.entity.ts` | P3-04b |
| `src/memberships/dto/create-membership-discount.dto.ts` | P3-04b |
| `src/finance/entities/invoice-discount.entity.ts` | P3-04b |
| `src/inventory/**` — the six entities, `inventory.dto.ts`, `inventory.constants.ts`, `inventory.module.ts` (the **service and controller both have specs**) | P3-05 |
| `packages/contracts/src/events/crm.events.ts`, `inventory.events.ts`, `pt.events.ts` (all new/untracked), plus the modified `finance.events.ts` — note that **no** contract event file anywhere has a spec, so this is a repo-wide convention rather than a Phase 3 gap | P3-05/P3-06/P3-11 |
| `src/finance/entities/webhook-event.entity.ts`, `payment-method.entity.ts`, `dunning-attempt.entity.ts` | P3-03/P3-08 |
| `src/finance/dto/attach-payment-method.dto.ts` | P3-03 |
| `src/pt/dto/cancel-pt-enrollment.dto.ts`, `create-commission-payout.dto.ts` | P3-11/P3-12 |
| `src/migrations/__specs__/` — the 12 new migrations are largely unspecced, **except** `…270-CreatePtCommissionPayoutTables.spec.ts` and `…271-ProvisionPtPayoutPermission.spec.ts`, which do exist | P3-03/P3-04b/P3-05/P3-06/P3-07/P3-08 |

What **does** exist, so the gap is bounded rather than total: P3-05 has `inventory.service.spec.ts` **and** `inventory.controller.spec.ts`; P3-06 has `crm.service.spec.ts`, `crm.controller.spec.ts`, `follow-ups.service.spec.ts`, `follow-ups.controller.spec.ts`, `sla.service.spec.ts`, `sla.controller.spec.ts` and `crm.constants.spec.ts`; P3-12 has `commission-payouts.service.spec.ts` and a controller spec; P3-08 has two specs; P3-03 has three; P3-11 has the enrollments spec.

So the pattern is consistent and deliberate: **services, controllers and constants are covered; entities, DTOs and barrel/module files are not.** That is a reasonable convention — entities and DTOs are declarative — but it is worth recording explicitly, because it is exactly the convention that let P3-04b's configurable-ordering gap (an entity/DTO-level concern) and the unruled dunning/renewal semantics pass review. The one substantive exception is that no spec pins `inventory-lot` expiry, which is a behaviour, not a declaration.

Also ❌ absent: the **combined tax + discount** scenario spec. Given §4's finding that discount ordering is hard-coded rather than configurable, this is the test that would pin the interaction; without it the ordering is enforced only by the shape of one ternary in `invoices.service.ts`.

---

## 6. Open questions requiring a ruling

| # | Question | Where it bites |
|---|----------|----------------|
| Q1 | **Is `HEAD` the deliverable baseline, or must the 92 uncommitted files be committed?** | Determines whether Phase 3 is "4 items done" or "12 items done". Everything else is downstream. |
| Q2 | If committed, is the P3-03 boot blocker fixed first? | Shipping the working tree as-is produces a non-booting `main`. |
| Q3 | Are `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` to be documented in `.env.example`? | P3-03 is unconfigurable and undiscoverable today. |
| Q4 | Should `GatewayWebhookService` adopt the adapter's `isConfigured` guard? | BLOCKER-2: without it, an optional credential breaks the whole app. |
| Q5 | Is discount-before-tax permanently correct, or is a configurable ordering still required by P3-04b's acceptance criteria? | The criterion as written is unmet. |
| Q6 | Confirm all-or-nothing clawback (Q16), or specify pro-rata. | P3-11 semantics. |
| Q7 | Is `PT_EVENT_VERSION = 'v1'` an intentional ruling or incidental churn? | A wire-format change with no recorded decision. |
| Q8 | Is an operator-triggered renewal route required for P3-09's acceptance criteria? | Renewal is currently service/worker-only. |
| Q9 | What is the ruling on Q14(a)/(b) for dunning (attempt counter owner; fixed vs. exponential schedule)? | Implementation is unruled. |
| Q10 | Does P3-10's S3 gap now need priority, given P3-05/P3-06 introduced the first non-document attachments? | §10 called it opportunistic; its premise has changed. |
| Q11 | Definitive position on RLS — implement `database-plan.md`'s policies, or amend the plan to accept app-level scoping permanently? | The plan mandates it; 17+ new tenant-scoped tables arrived this phase. |

---

## 7. Summary

| Status | Items |
|--------|-------|
| ✅ Complete (committed on `main` / `origin/main` @ `c7f84c08`) | **P3-01, P3-02, P3-04** |
| 🚧 Partial (uncommitted) | **P3-03** (blocked), **P3-04b**, **P3-05**, **P3-06**, **P3-07**, **P3-08**, **P3-09**, **P3-11**, **P3-12** |
| ❌ Missing | **P3-10** (not started), **DEF-01** (not fixed) |

**The headline is not the feature status — it is the commit boundary.** Twelve of the thirteen Phase 3 items are implemented to some degree, but **only three are committed**, and the uncommitted supermajority contains a defect that prevents the application from starting. Every automated gate is green on that broken tree, because the gates cannot boot the application by construction and the module specs hand-assemble their provider lists.

**Ordered recommendation:**

1. **Fix BLOCKER-2 first** (guard `new Stripe(...)` behind the configured check) — it converts a fatal failure into a graceful degradation. It is a small, contained change.
2. **Fix BLOCKER-1** (export `WebhookEventProcessor`, `GatewayWebhookService`, `StripePaymentGatewayAdapter` from `FinanceModule`, or restructure the worker's dependency).
3. **Add `app.module.spec.ts`** asserting `AppModule` compiles with `STRIPE_SECRET_KEY` unset, so neither regression can recur.
4. **Document the two Stripe keys** in `.env.example`.
5. **Then** resolve the commit decision (Q1) and commit, followed by the P3-04b / P3-11 / dunning / renewal rulings.
6. **Separately**, settle the RLS divergence in §4.3 by ruling on Q11 — the plan document currently asserts a requirement no phase has implemented, and Phase 3 added 17+ tenant-scoped tables on top of that gap.

**Verification honesty note:** the four gates and the fresh-DB migration replay are reported from captured command output and are trustworthy. The **boot-blocker findings are reproduced**, but the probe harness was a temporary `ts-node` script that has since been deleted, and the worktree used for the HEAD baseline check was removed — so re-verification requires re-running §1.1's three-variant probe. Nothing in this report is based on a prior session's summary; every claim was re-derived against the repository during this run.

**Cleanup:** both temporary worktrees removed (`git worktree list` shows only the three long-lived ones), no `tmp-*` or scratch files remain in the repository, and the temporary `gym_p3_final_*` database was dropped. Logs remain under `/tmp/` (`boo2.log`, `boo3.log`, `mig-final.log`, `v4-*.log`, `v5-webtsc.log`, and the `d-*.diff` files written this run) in case the raw evidence is wanted.

