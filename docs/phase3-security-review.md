# Phase 3 Security Review (D14)

**Date:** 2026-10-01
**Baseline:** `main` @ `89cefcd3`, plus the uncommitted Phase 3 sign-off work in the working tree
(this review, the D15 API gate, the tenant-context fix and OI-2). Every claim below is either a
file:line citation read in that tree or the raw output of a command run against it.
**Scope (owner ruling, `docs/phase3-scoping-plan.md` §15.2 D14):** the unauthenticated
`POST /v1/webhooks/payment-gateway` and stored provider tokens.
**Method:** code inspection with file:line evidence; executed evidence from the D15 API gate
(`scripts/api-gate.js`, checks `wh-01`…`wh-05`) and a new unit spec; the deliverable is findings,
not a penetration test. **Not covered:** infrastructure-level controls, TLS/network policy,
dependency scanning, and the plan-only controls listed in §5.

Legend: **Fixed** = remediated in this pass (Critical/High policy) · **Filed** = recorded as a
`DEF-xx` backlog entry.

---

## 1. Findings

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| **F1** | **High** | The webhook's fail-closed signature path had **no test coverage at all**; the scoping plan required an unsigned/tampered-payload case and none existed. | **Fixed** — `gateway-webhook.service.spec.ts` (mutation-verified, §3) |
| **F2** | Medium | Duplicate delivery races the check-then-insert on `provider_event_id`; the unique index is the only backstop, so a concurrent duplicate surfaces as an unhandled 500. | Filed — `DEF-02` |
| **F3** | Medium | `FINANCE_WEBHOOK_EVENTS.organization_id` is never populated (always NULL), so stored webhook rows carry no tenant attribution. | Filed — `DEF-04` |
| **F4** | Medium | No lease/timeout: a crash mid-processing leaves a row in `'processing'` forever, and `'failed'` rows are never retried. | Filed — `DEF-05` |
| **F5** | Medium | The processor classifies outcomes by `event.type.includes('succeeded')` and loads the payment by id with **no organization predicate**. | Filed — `DEF-06` |
| **F6** | Medium | No HTTP request throttling exists; the unauthenticated webhook and `POST /v1/auth/login` are unthrottled. (The AI module's Redis budgets are per-organization *usage* limits on AI endpoints only — they do not throttle requests.) App-wide, pre-existing, **outside D14 scope**. | Filed — `DEF-07` |
| **F7** | Low | Hardening residuals: no explicit Stripe `tolerance`; rejections are not logged; the raw payload is stored unencrypted; provider tokens/last4 are stored plaintext (Stripe tokens are not cardholder data, so this is defence-in-depth, not a PCI finding). | Filed — `DEF-08` |

Both webhook entry points that matter are cited precisely:

- `@Public()` on the route: `src/finance/controllers/gateway-webhook.controller.ts:12-13` — the
  ONLY unauthenticated state-changing route in the application.
- The fail-closed guard: `src/finance/services/gateway-webhook.service.ts:26-29`.

---

## 2. What this review verified as safe (with evidence)

| Control | Evidence |
|---|---|
| **Signature verification fails closed** | `gateway-webhook.service.ts:26` rejects when the header, the `STRIPE_WEBHOOK_SECRET`, or the Stripe client is absent — the three cases are each pinned by a spec (§3). Executed: gate `wh-01` (no signature → 400 `"Invalid webhook signature"`), `wh-02` (wrong-secret signature → 400). |
| **The signature is verified over the RAW body** | `main.ts:11` boots with `rawBody: true`; the controller forwards `request.rawBody` unmodified (`gateway-webhook.controller.ts:15`); the new spec asserts `constructEvent(rawBody, signature, secret)` receives that exact buffer. |
| **Accepted events are persisted and replay is idempotent** | Executed: gate `wh-03` (signed → 201 `{received:true}`), `wh-04` (row in `FINANCE_WEBHOOK_EVENTS`, status `received`), `wh-05` (identical replay → 201, still exactly one row). |
| **No raw card data is accepted or stored** | `attach-payment-method.dto.ts:5-15` rejects `card_number`/`card_cvc`/`card_exp_month`/`card_exp_year` via `@IsEmpty`; executed: gate `fin-10` → 400 `"Raw card data must not be submitted"`. `FINANCE_PAYMENT_METHODS` holds only `stripe_customer_id`, `stripe_payment_method_id`, `card_brand`, `card_last4` (`payment-method.entity.ts:16-29`). |
| **A missing Stripe key cannot take the app down** | `new Stripe()` is constructed only when the key is truthy (`gateway-webhook.service.ts:21-22`, `stripe-payment-gateway.adapter.ts:14-18`); `PAYMENT_GATEWAY` falls back to `UnavailablePaymentGateway` (`finance.module.ts:113`); pinned by `app.boot.spec.ts:155-187`. |
| **Payment methods are tenant-scoped on write** | `payment-methods.service.ts:26-45` resolves the authorized organization and validates the member belongs to it; the cross-org path is pinned in `payment-methods.service.spec.ts:67-79`. |
| **The `@Public()` surface is exactly four routes** | `grep -rn '@Public()' src` → auth controller (`register`, `login`, `refresh`, `verify-mfa`), the webhook, and `/v1/health`. Nothing else opts out of the global `JwtAuthGuard`. |
| **The webhook route is guarded by authentication-by-signature only — by design** | Plan §3's claim that the route must be "exempt from the `@RequirePermissions` guard path" is imprecise (scoping-plan §15.1 **O5**): `PermissionsGuard` already passes routes with no permission metadata (`permissions.guard.ts:31`); `@Public()` is the actual bypass and is the only thing the route needs. Recorded here so a future reviewer is not misled. |

---

## 3. The High finding, remediated

**F1 — the security control was real but unpinned.** Before this pass,
`grep -rn 'constructEvent\|stripe-signature' src --include='*.spec.ts'` returned nothing: the
fail-closed guard, the only defence on the only unauthenticated state-changing route, had no
test asserting it. A refactor that dropped `!this.secret` (or reordered the check) would have
left every existing test green.

**Fix:** `src/finance/services/gateway-webhook.service.spec.ts` — six cases: missing header;
unset secret; no Stripe client; SDK rejection (tampered payload); valid delivery (asserts the
raw-body verification and the persisted row); duplicate delivery (no second insert).

**Mutation evidence (run this session).** Removing only the `!this.secret` condition
(`if (!signature || false || !this.stripe)`) and re-running the spec:

```
✓ rejects a delivery with no signature header
✕ rejects every delivery when the webhook secret is not configured (fails closed)
✓ rejects every delivery when no Stripe client could be constructed
✓ rejects a tampered payload (the SDK rejects the signature)
✓ verifies the signature over the RAW body and persists the event once
✓ is idempotent: a duplicate delivery persists nothing and still returns received
Tests:       1 failed, 5 passed, 6 total
```

The file was restored immediately (`grep -c '!this.secret'` → `1`). A second mutation attempt
that removed the whole guard failed to compile (TypeScript narrowing on `this.stripe`), which is
itself a small piece of structural protection.

---

## 4. Findings filed (not fixed in this pass)

Per the owner's ruling, only Critical/High findings are remediated in this pass; the rest are
filed as backlog defects. The entries are in `docs/task-backlog.md` §Known Defects:

- **`DEF-02` — duplicate-delivery race → unhandled 500.** `gateway-webhook.service.ts:30-36`
  reads then inserts; two concurrent deliveries of the same event both miss the read, and the
  second INSERT hits `UQ_finance_webhook_events_provider_event`
  (`1788965263260-AddPaymentGatewayAndWebhookEvents.ts:15`) as an unmapped `23505`. Data stays
  correct (one row); the client sees a 500 and Stripe retries. The gate's `wh-05` proves the
  sequential replay path only.
- **`DEF-04` — no tenant attribution on webhook rows.** The column exists and is nullable
  (`webhook-event.entity.ts:22-23`) but `receive()` never sets it
  (`gateway-webhook.service.ts:32-35`). The processor resolves the tenant implicitly through the
  payment row, so correctness holds; auditability does not.
- **`DEF-05` — stuck `'processing'`, never-retried `'failed'`.** Rows are claimed into
  `'processing'` (`webhook-event.processor.ts:22-23`) and only leave it on success (`:56`) or a
  caught error (`:26`); a process crash leaves the row claimed forever, and `'failed'` rows are
  terminal.
- **`DEF-06` — outcome classification and unscoped payment lookup.**
  `webhook-event.processor.ts:41` treats any event type containing `succeeded` as success, and
  `payments.service.ts:443-446` loads the payment by `{ id }` alone. Both are reachable only with
  a validly signed payload, so this is defence-in-depth rather than a live bypass.
- **`DEF-07` — no HTTP request throttling.** `@nestjs/throttler` is not a dependency and no
  guard limits request rates (`grep -rniE 'throttler' src package.json` → nothing). The AI
  module's Redis counters (`src/ai/services/ai-usage-limit.service.ts`) limit per-organization
  AI *usage* on AI endpoints only; they do not throttle HTTP requests generally. The
  unauthenticated webhook and `POST /v1/auth/login` are therefore exposed to unbounded attempts.
  App-wide and pre-existing (not introduced by Phase 3); filed for the hardening track.
- **`DEF-08` — webhook hardening residuals (Low).** No explicit `tolerance` on
  `constructEvent` (`gateway-webhook.service.ts:28`; Stripe's 300 s default applies), no log
  line on rejection, raw payload stored unencrypted, provider tokens/last4 plaintext at rest
  (`EncryptionService` exists and is used only for MFA — `mfa.service.ts:16`).

**Also found during the D15 gate, not a security finding:** `POST /v1/branches` returns an
unhandled 500 when `address`/`phone` are omitted — the DTO marks them optional
(`create-branch.dto.ts`) while the columns are NOT NULL (`branch.entity.ts:15-19`). Filed as
`DEF-03`.

---

## 5. Not covered, and explicitly not claimed

- **Infrastructure controls** (TLS termination, WAF, network segmentation, secret management)
  are described in `docs/security-plan.md` as target design; none of them is implemented in this
  repository and none is assessed here.
- **No penetration test, no dependency scan, no DAST.** The review is code inspection plus the
  executed checks above.
- **Stripe-side configuration** (webhook endpoint secret rotation, dashboard access, API key
  scoping) is out of the repository's reach.
- **The `@Public()` auth routes** (`register`, `login`, `refresh`, `verify-mfa`) were not
  reviewed beyond the enumeration in §2; they predate Phase 3 and their exposure is recorded as
  `DEF-07` (rate limiting) only.
- **`verify-mfa` and MFA storage** were not in scope; `EncryptionService` usage there was noted
  only as the contrast case for `DEF-08`.

---

## 6. Verdict

The Phase 3 gateway surface is **fit to ship on the condition that `DEF-02`, `DEF-04`, `DEF-05`
and `DEF-06` are worked in the post-sign-off hardening pass** and `DEF-07` (rate limiting) is
scheduled as the highest-value app-wide follow-up. The single High finding was a coverage gap,
not a live vulnerability: the fail-closed behaviour was correct before this review and is now
pinned by tests and by the D15 gate's executed checks.

*End of review.*
