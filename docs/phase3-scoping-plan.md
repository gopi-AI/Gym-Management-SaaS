# Phase 3 Scoping Plan — Finance Extension / Retail Inventory / CRM

> **Status**: DRAFT — 23 open questions collected (see §15). No implementation decisions are final until the open questions are resolved.
> **Purpose**: Define entities, event contracts, module boundaries, RBAC permissions, and build order for the three Phase 3 sub-systems: the Financial System extension, Retail Inventory, and CRM.
> **Constraint**: No code, entities, migrations, or DTOs are produced from this document. This is a planning artifact only.
> **Baseline**: Verified against source and the planning docs on 2026-09-17 (Phase 1 finance module, Phase 2 PT/loyalty modules, `docs/database-plan.md`, `docs/event-contracts.md`, `docs/domain-map.md`, `docs/api-plan.md`, `docs/task-backlog.md`).
> **Target audience**: Technical decision-maker (reviewer of the plan).

---

## Table of Contents

1. [Finance Extensions — Financial Ledger Read Model (P3-01)](#1-finance-extensions--financial-ledger-read-model-p3-01)
2. [Finance Extensions — Refunds & Credit Notes (P3-02)](#2-finance-extensions--refunds--credit-notes-p3-02)
3. [Finance Extensions — Payment Gateway Integration (P3-03)](#3-finance-extensions--payment-gateway-integration-p3-03)
4. [Finance Extensions — Tax Handling & Discounts (P3-04)](#4-finance-extensions--tax-handling--discounts-p3-04)
5. [Finance Extensions — Recurring Billing & Dunning (P3-08 / P3-09)](#5-finance-extensions--recurring-billing--dunning-p3-08--p3-09)
6. [Finance Extensions — Commission Payout & Clawback (Phase 2 extension)](#6-finance-extensions--commission-payout--clawback-phase-2-extension)
7. [Retail Inventory (P3-05)](#7-retail-inventory-p3-05)
8. [CRM — Lead Management (P3-06)](#8-crm--lead-management-p3-06)
9. [CRM — Follow-ups & SLAs (P3-07)](#9-crm--follow-ups--slas-p3-07)
10. [Storage Configuration (P3-10 — Phase 3 gap)](#10-storage-configuration-p3-10--phase-3-gap)
11. [Existing Pattern Application Summary](#11-existing-pattern-application-summary)
12. [Proposed Build Order](#12-proposed-build-order)
13. [Cross-Domain Dependencies](#13-cross-domain-dependencies)
14. [Scope Risks & Underspecified Areas](#14-scope-risks--underspecified-areas)
15. [Open Questions (23 items)](#15-open-questions-23-items)

---
## 1. Finance Extensions — Financial Ledger Read Model (P3-01)

### Domain context

Finance is an existing bounded context (`docs/domain-map.md` line 96): `finance | invoices, invoice_items, payments, payment_allocations, refunds, credit_notes, tax_lines, financial_ledger`. **Phase 1 delivered the first three** — `invoices`, `invoice_items`, `payments`. `payment_allocations` was **not** built: the finance migration states that the remainder of the ERD's finance block, “payment allocations” included, is “intentionally NOT created” (`src/migrations/1788965263234-CreateFinanceSchema.ts` lines 12–14). Whether allocations are in scope for Phase 3 at all is §15 Q4. The database plan already defines the remaining tables (ERD lines 240–283):

- `FINANCE_PAYMENT_ALLOCATIONS` — `id, payment_id, invoice_item_id, allocated_amount, created_at`
- `FINANCE_REFUNDS` — `id, payment_id, reason, amount, refund_date, status, created_at`
- `FINANCE_CREDIT_NOTES` — `id, invoice_id, reason, amount, issued_date, status, created_at`
- `FINANCE_TAX_LINES` — `id, invoice_item_id, tax_name, tax_rate, tax_amount`
- `FINANCE_FINANCIAL_LEDGER` — `id, transaction_date, account_type, account_number, description, debit_amount, credit_amount, reference_id, reference_type, created_at`

**Important gap in the ERD definition**: `FINANCE_FINANCIAL_LEDGER` has **no `organization_id`** and **no `currency`** column. Every other tenant table in this codebase carries `organization_id` (Phase 1 added it to `FINANCE_INVOICE_ITEMS` as “the one approved addition to that spec” — `src/finance/entities/invoice-item.entity.ts` lines 9–11). The ledger needs the same approved deviation, plus a currency decision — see §15 Q1 and the multi-currency risk in §14.2.

### Existing state — what Phase 1 built

| Artifact | Status | Phase 3 implication |
|----------|--------|---------------------|
| `Invoice` (`FINANCE_INVOICES`) | Built. Carries `subtotal`, `tax_amount` (always `0.00`), `total_amount`, `status`, `paid_at`. | `tax_amount` becomes meaningful in §4. |
| `InvoiceItem` (`FINANCE_INVOICE_ITEMS`) | Built. `tax_code` nullable and **unused** (“tax handling is out of scope”). | Populated by §4. |
| `Payment` (`FINANCE_PAYMENTS`) | Built. `status` is `pending → succeeded / failed`; manual desk recording writes directly to `succeeded`. | `pending` payments become gateway-driven in §3/§5. |
| `InvoiceNumberCounter` | Built, pessimistically locked per org. | Unchanged. |
| `InvoicesService.voidInvoice()` | Built, but **explicitly refuses paid invoices**: “A paid invoice cannot be voided; issue a refund/credit note instead (out of scope)”. | §2 replaces the “out of scope” escape hatch. |
| `PaymentsService` | Built, but **over-payments explicitly out of scope**: “Over-payments (and the credit/refund handling they imply) are out of scope”. | §2 introduces credit/refund handling. |
| `FINANCE_EVENT_TYPES` | Only `InvoiceCreated`, `PaymentSucceeded`, `PaymentFailed`. | §2/§3 add Phase 3 events to `finance.constants.ts`, `packages/contracts/src/events/finance.events.ts` **and** `docs/event-contracts.md` (three-way lockstep). |

### Existing pattern to reuse

The amount paid against an invoice is **not denormalised** — it is derived from succeeded payments (`invoice.entity.ts` lines 25–27: “the payments table stays the single source of truth and no schema column is invented”). The ledger read model must respect this: ledger figures are **derived**, and the invoice/payment tables remain the source of truth.

### Proposed approach (read model, not a new write path)

P3-01 is a **read model** task. It must not introduce a second write path that could disagree with the invoice/payment/refund/credit-note tables.

| Option | Description | Trade-off |
|--------|-------------|-----------|
| **(a) Materialized view** | `REFRESH MATERIALIZED VIEW` on schedule or on-demand; unique index for `CONCURRENTLY`. | Fast reads; staleness window; refresh cost; migration-managed. |
| **(b) Denormalized table + event handlers** | An outbox consumer writes ledger rows per business event. | Consistent with outbox usage, but creates a **second source of truth** and a reconciliation burden. |
| **(c) Plain database view** | No caching; always current. | Zero staleness; performance degrades as invoice/payment volume grows. |

**Recommended default (subject to §15 Q1)**: **(a) materialized views for the two reporting views, plus (c) a plain view for the per-member outstanding balance** (single-row lookups do not benefit from materialization). Option (b) is **not recommended**: it duplicates the source of truth that Phase 1 deliberately kept out of the schema.

### Proposed read-model objects

| Object | Kind | Definition | Serves |
|--------|------|------------|--------|
| `V_FINANCE_MEMBER_OUTSTANDING` | plain view | Per (`organization_id`, `member_id`): sum of `total_amount` for invoices in `OUTSTANDING_INVOICE_STATUSES`, minus succeeded payments and applied credit notes against them. | `GET /v1/members/{id}/outstanding-balance` |
| `MV_FINANCE_REVENUE_BY_PERIOD` | materialized view | Revenue aggregated by (`organization_id`, `branch_id`, period) from succeeded payments minus refunds. | `GET /v1/financial-reports/revenue-summary` |
| `MV_FINANCE_OUTSTANDING_BY_STATUS` | materialized view | Invoice counts and amounts grouped by `status` and ageing bucket. | `GET /v1/financial-reports/outstanding-by-status` |

`OUTSTANDING_INVOICE_STATUSES` already exists in `src/finance/finance.constants.ts` (`draft`, `sent`, `partially_paid`) — the view definition must reuse that constant rather than re-declare the list.

**This design supersedes `docs/database-plan.md`'s `REPORTS_MATERIALIZED_VIEWS` sketch (line 715).** That sketch models materialized views as a *runtime registry table* — rows carrying `name`, `description`, `last_refreshed` — i.e. a generic, runtime-configurable view catalogue. Phase 3 instead defines a **small, fixed set of known views** that migrations create and own, with refresh configuration held in code: a generic runtime table buys nothing at this scale and adds a mutable second home for view definitions. Two scope notes follow: the `reporting` schema-isolation recommendation (line 912) is **not** superseded and still applies, and the generic `GET /v1/report/materialized-views*` endpoints (`docs/api-plan.md` lines 160–161) belong to the Reports domain, not Phase 3.

**This also supersedes backlog P3-01's “Create materialized view for member outstanding balance”** (`docs/task-backlog.md` line 383). That acceptance criterion presumes materialization; §1 instead serves the per-member balance from a **plain view** (`V_FINANCE_MEMBER_OUTSTANDING`), because a single-row lookup by (`organization_id`, `member_id`) gains nothing from a cached aggregate and would only add a staleness window. The two *reporting* views remain materialized, as the backlog intends.

### API surface (`docs/api-plan.md` §Reports, task backlog P3-01)

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `GET /v1/members/{id}/outstanding-balance` | `finance:read` | Requires `MembersModule` import for member validation. |
| `GET /v1/financial-reports/revenue-summary` | `finance:read` (or new `finance:report`) | Query params: `from`, `to`, `branchId`, `period`. |
| `GET /v1/financial-reports/outstanding-by-status` | `finance:read` (or `finance:report`) | Ageing buckets defined by policy — needs a decision. |

### Entities

**None new.** This task adds database views plus a read service inside `src/finance/`. No entity is registered for a view; queries run through the injected `DataSource` with explicitly org-scoped SQL (`WHERE organization_id = $1`), matching the existing tenant-scoping pattern. A migration creates the views and their indexes.

### Event contracts

**None.** Read models publish no events.

### RBAC permissions

Reuses the existing `finance` resource token. If the reviewer wants reporting separated from day-to-day finance access, a `finance:report` action is a zero-migration addition (permissions are guard metadata, not schema) — see §15 Q3.

---

## 2. Finance Extensions — Refunds & Credit Notes (P3-02)

### Domain context

Phase 1 deliberately left two escape hatches open, and both must be closed here:

- `InvoicesService.voidInvoice()` rejects paid invoices with *“A paid invoice cannot be voided; issue a refund/credit note instead (out of scope)”* and rejects invoices with money collected with *“refunds are out of scope, so it cannot be voided”*.
- `PaymentsService` rejects over-payments with *“Over-payments (and the credit/refund handling they imply) are out of scope”*.

§2 is therefore also a **debt-repayment** task: once refunds and credit notes exist, those guard rails must be revisited so their messages point at real functionality instead of “out of scope”.

### Refund vs credit note — the distinction that drives the design

| | Refund | Credit note |
|---|--------|-------------|
| Attaches to | A **payment** (`FINANCE_REFUNDS.payment_id`) | An **invoice** (`FINANCE_CREDIT_NOTES.invoice_id`) |
| Meaning | Money is returned to the member | The invoice is reduced without money moving |
| Direction | Cash out | Balance reduction |
| Gateway involvement | Yes — gateway refund in §3 | No |
| Ledger effect | Debit revenue / credit cash | Debit revenue / credit receivables |

The ERD fixes the attachment points, so the API split (`POST /v1/payments/{id}/refunds` vs `POST /v1/invoices/{id}/credit-notes`) is already determined.

### Proposed entities (inside existing `src/finance/entities/`)

| Entity | Table | Key fields | Relationships | Notes |
|--------|-------|-----------|---------------|-------|
| `PaymentAllocation` | `FINANCE_PAYMENT_ALLOCATIONS` | id, payment_id, invoice_item_id, allocated_amount, created_at | → Payment, → InvoiceItem | Per-ERD. Needed for line-level reporting. **Requires `organization_id`** like `InvoiceItem` (the approved deviation). Is line-level allocation in scope for P3, or optional? — §15 Q4. |
| `Refund` | `FINANCE_REFUNDS` | id, payment_id, reason, amount, refund_date, status, created_at | → Payment | Per-ERD. **Requires `organization_id`**. `status` needs a state machine (`pending → succeeded / failed`, mirroring `PAYMENT_STATUS`). |
| `CreditNote` | `FINANCE_CREDIT_NOTES` | id, invoice_id, reason, amount, issued_date, status, created_at | → Invoice | Per-ERD. **Requires `organization_id`** for direct org-scoped listing (`GET /v1/credit-notes`). |

**Status value sets** should be declared in `finance.constants.ts` alongside the existing `INVOICE_STATUS` / `PAYMENT_STATUS` (e.g. `REFUND_STATUS`, `CREDIT_NOTE_STATUS`) rather than inlined as string literals — this mirrors the existing convention.

### The two invariants this service must own

Both mirror the Phase 2 single-write-path pattern (`PtEnrollmentsService.create()` writes enrollment + commission + outbox in one transaction):

1. **Refund invariant** — a refund can never exceed the *un-refunded* portion of its payment: `SUM(refunds.amount for payment) ≤ payment.amount`, and only payments in `succeeded` status are refundable. Enforced inside the transaction (not by a pre-check), because two concurrent refunds would otherwise both pass a read-then-write check.
2. **Credit note invariant** — a credit note can never exceed the *un-credited* invoice total, accounting for payments already collected. Because the existing invoice `status` machine has no `credited` state, the design must decide how a fully credited invoice is represented (§15 Q5).

### How this interacts with the existing invoice state machine

`VALID_INVOICE_TRANSITIONS` currently ends at `paid → []` and `void → []`. Refunds and credit notes introduce *post-terminal* financial adjustments that the current machine cannot express. Two viable models:

- **Model A — adjustments are separate records; invoice status untouched.** A credit note reduces the *outstanding balance* (a derived figure) but never rewrites `Invoice.status`. Retro-compatible: no change to `VALID_INVOICE_TRANSITIONS`, no change to `voidInvoice()`’s paid guard.
- **Model B — new `credited` / `refunded` states.** Requires extending `VALID_INVOICE_TRANSITIONS` and revising `voidInvoice()`. More expressive, but changes Phase 1 behaviour and every existing finance test.

**Recommended default (subject to §15 Q5)**: **Model A.** It preserves the Phase 1 invariants and the derived-balance pattern, and keeps the ledger as the place where adjustments are visible. Model B should only be chosen if a reviewer needs invoice-level refund status in list views.

### API surface (task backlog P3-02 + `docs/api-plan.md` line 75)

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `POST /v1/payments/{id}/refunds` | `finance:refund` (new action) | “enhanced” in the backlog — the endpoint name is already fixed. |
| `GET /v1/refunds` | `finance:read` | Paginated, filterable, org-scoped. |
| `POST /v1/invoices/{id}/credit-notes` | `finance:credit-note` (new action) | |
| `GET /v1/credit-notes` | `finance:read` | Paginated, filterable, org-scoped. |

A distinct **`finance:refund`** action is strongly recommended: issuing money back to a member is a materially different authority from recording a payment, and the existing `record-payment` action shows the codebase already splits finance write actions this way (`resource: 'finance', action: 'record-payment'`).

### Event contracts

| Event | Payload (proposed) | Consumers |
|-------|--------------------|-----------|
| `RefundIssued` | `{ refundId, paymentId, invoiceId, organizationId, amount, reason, refundDate, status }` | Ledger/reporting, notifications |
| `CreditNoteIssued` | `{ creditNoteId, invoiceId, organizationId, amount, reason, issuedDate, status }` | Ledger/reporting, notifications |

**These names are deliberately unversioned, matching the finance convention.** `FINANCE_EVENT_TYPES` stores bare names (`'InvoiceCreated'`) and carries the version separately in `FINANCE_EVENT_VERSION = 'v1'` (`src/finance/finance.constants.ts` lines 64, 74–77). PT does the opposite, inlining the version (`TRAINER_COMMISSION_EARNED: 'TrainerCommissionEarned.v1'`, `src/pt/pt.constants.ts` line 19). §2 follows **finance**, since these are finance events; §15 Q17 covers the same inconsistency for the PT family.

Both names are **already reserved** in `docs/domain-map.md` (line 96: `…, RefundIssued, CreditNoteIssued, FinancialLedgerUpdated`) but **absent from `docs/event-contracts.md`**, which documents only `PaymentSucceeded`, `PaymentFailed`, `InvoiceCreated`. Adding them requires edits in **three** places kept in lockstep (per the warning in `finance.constants.ts` lines 66–72):

1. `packages/contracts/src/events/finance.events.ts` (published contract)
2. `src/finance/finance.constants.ts` (`FINANCE_EVENT_TYPES` mirror)
3. `docs/event-contracts.md` (documentation)

### RBAC permissions

| Action | Rationale |
|--------|-----------|
| `finance:read` | List refunds/credit notes (existing). |
| `finance:refund` | **New** — issue money back to a member. |
| `finance:credit-note` | **New** — reduce an invoice without moving money. |
| `finance:update` | Reused by `voidInvoice`; unchanged. |

### Phase 3+ dependencies

- **Depends on §3** if refunds are executed through the gateway rather than recorded manually — see §15 Q5.
- **Feeds §1** — refunds and credit notes are inputs to the revenue and outstanding read models.
- **Feeds §6** — an enrollment cancellation that refunds its invoice is the trigger for commission clawback.

---

## 3. Finance Extensions — Payment Gateway Integration (P3-03)

### Domain context — the seam already exists

Phase 1 built a deliberate provider seam and Phase 3 plugs into it. **No redesign is required**:

```ts
// src/finance/services/payment-gateway.port.ts
export interface PaymentGatewayPort {
  readonly isConfigured: boolean;
  attempt(payment: Payment): Promise<PaymentAttemptOutcome>;
}
export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';
```

with `UnavailablePaymentGateway` as the default binding (`isConfigured = false`, `attempt()` returns a well-formed `GATEWAY_NOT_CONFIGURED` failure). The port doc states its purpose explicitly: *“Phase 3 can plug Stripe/Paymob/… in without touching the worker, the retry bookkeeping or the `PaymentSucceeded`/`PaymentFailed` contracts.”*

### Existing state — what Phase 1 built

| Artifact | Status | Phase 3 implication |
|----------|--------|---------------------|
| `PAYMENT_GATEWAY` token + `PaymentGatewayPort` | Built and injected into `PaymentRetryService`. | Implement `StripePaymentGateway` (or equivalent) and rebind the provider. |
| `UnavailablePaymentGateway` | Built. `isConfigured = false` prevents the retry worker mutating payments. | Kept as the fallback for deployments with no provider. |
| `PaymentRetryService` + `payment-retry.worker.ts` | Built. Reports a skipped run when `isConfigured` is false. | Becomes the dunning engine in §5. |
| `Payment.status` | `pending → succeeded | failed`. Gateway payments enter as `pending`. | Already the correct entry state. |
| `PAYMENT_RETRY_DEFAULTS` | `MAX_ATTEMPTS: 3`, `BATCH_SIZE: 50`, exponential backoff `BASE_DELAY_MS × 2^(n-1)`, capped at `MAX_DELAY_MS`. | Reused by §5; see §15 Q14. |

The important architectural point: **the retry worker, the retry bookkeeping and the `PaymentSucceeded`/`PaymentFailed` contracts must not change.** Only the binding changes.

### Proposed new artifacts

| Artifact | Kind | Purpose |
|----------|------|---------|
| `StripePaymentGateway` (name TBD — §15 Q11) | Provider adapter implementing `PaymentGatewayPort` | Calls the provider API to charge a `pending` payment. |
| `GatewayWebhookController` | Controller | `POST /v1/webhooks/payment-gateway` — receives provider callbacks. |
| `WebhookEvent` (new table) | Entity | Webhook idempotency + audit: provider event id (unique), type, payload, processed_at. |
| `Payment.gateway_*` columns | Migration | Provider-side fields (`gateway_reference`, `gateway_status`, `gateway_response`). Backlog says “Enhance payments table with gateway-specific fields”. |
| `Membership`/`Member` payment-method storage | Open question | Recurring billing needs a saved payment method — see §15 Q10. |

### Webhook idempotency — the critical correctness requirement

The backlog lists `POST /v1/webhooks/payment-gateway` as **“(idempotent)”**, and P3-03 depends on **P0-06 (idempotency)**. The design must therefore:

1. Persist each provider event with its provider-assigned unique event id under a **UNIQUE constraint**.
2. Reject/deduplicate a repeated event id without re-applying side effects.
3. Apply state changes inside the same transaction that records the event, so a crash cannot half-apply.

This mirrors the existing `Payment.idempotency_key` convention (ERD: `string idempotency_key UK`), which is the established idempotency pattern in this codebase. Webhooks are the highest-risk surface for double-crediting a member, so it should reuse that established pattern rather than invent a new one.

**Webhook authentication**: the provider signs its payloads; the controller must verify the signature before trusting any field. This is a security-plan concern (`docs/security-plan.md`) and should be captured as a test case (rejected unsigned/tampered payload).

### API surface (task backlog P3-03)

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `POST /v1/payments/{id}/process` | `finance:record-payment` (or new `finance:charge`) | Initiates a gateway payment for an invoice. |
| `POST /v1/webhooks/payment-gateway` | **None** (unauthenticated by nature) | Authenticated by provider signature instead. Must be exempt from the standard `@RequirePermissions` guard path — flag for the security review. |

### Event contracts

**No new events required.** P3-03 must keep emitting the existing `PaymentSucceeded.v1` / `PaymentFailed.v1` payloads unchanged — the port doc explicitly promises this. Gateway metadata (transaction id) is already carried in `PaymentSucceeded.transactionId`. If a distinct “payment initiated” signal is wanted, that is a new contract and should be justified separately.

### RBAC permissions

Reuses `finance:read` / `finance:record-payment`. The webhook route is the **only** new finance route in this plan with no permission guard, and that must be an explicit, documented exception.

### Workers

`payment-retry.worker.ts` already exists and needs only the provider binding (plus the §5 dunning policy). The backlog additionally mentions a “Webhook processing worker (if using queue)” — see §15 Q12 and the worker-infrastructure risk in §14.7.

### Phase 3+ dependencies

- **Blocks §2** if refunds are gateway-executed.
- **Blocks §5** — dunning cannot retry what it cannot charge.
- **Depends on P0-06** (idempotency) per the backlog.
- **Known gap inherited from §2 — refund idempotency.** P3-02 records refunds
  without an idempotency key. The only protection is the
  `SUM(refunds.amount) ≤ payment.amount` invariant plus the payment row lock, so a
  *duplicate* submission that still fits under the payment's remaining balance
  would be recorded twice as two legitimate refunds. Accepted for P3-02, where
  every refund is a human at a desk acting deliberately (Q5's ruling), and it must
  be closed **here**: gateway-initiated refunds make automated retries possible,
  and a retried refund is indistinguishable from a second refund without a key.
  `RefundsService.create()` carries the same note at the call site.
- **`RefundsService.refundedTotal()` must keep counting ONLY `succeeded` refunds.** That figure *is* the cap for `SUM(refunds.amount) ≤ payment.amount` — the app-level backstop standing in for a cross-row `CHECK`, which PostgreSQL cannot express. It is correct today only because nothing yet writes a non-`succeeded` refund: P3-02 records every refund directly as `succeeded`. **P3-03 introduces `pending` refunds**, and a `pending` refund has not returned money, so it must not consume the refundable balance — drop or weaken the filter and a legitimate refund is refused against a balance that was never actually spent. Verified during P3-02 by mutation testing: removing that filter leaves the **entire suite green (82 suites / 922 tests)**, so nothing currently holds the behaviour in place. The regression test is tracked separately; this note exists so P3-03 does not treat an untested filter as a safe one to change.

---

## 4. Finance Extensions — Tax Handling & Discounts (P3-04)

### Domain context — the tax surface exists but is inert

Phase 1 built the *shape* of tax handling and deliberately left it empty. Every hook a tax engine needs is already present:

| Hook | Phase 1 state | Evidence |
|------|---------------|----------|
| `Invoice.tax_amount` | Column exists, **always written `0.00`** | `invoice.entity.ts` lines 65–71: *“Tax is explicitly OUT OF SCOPE for this Phase 1 pass… it is always written as 0.00 and has a follow-up ticket rather than a half-built tax engine.”* |
| `InvoiceItem.tax_code` | Column exists, **nullable and unused** | `invoice-item.entity.ts` lines 13–14 |
| `InvoiceLineItemDto.tax_code` | DTO accepts it, marked **“Unused in this pass”** | `create-invoice.dto.ts` lines 32–36 |
| `Invoice.subtotal` / `total_amount` | Both stored explicitly alongside `tax_amount` | `invoice.entity.ts` lines 62–74 |

**Consequence for §15 Q9**: the entity already stores `subtotal`, `tax_amount` **and** `total_amount` as separate columns, so the tax-inclusive vs tax-exclusive question is *already answered by the schema* — “both stored explicitly” is the existing design. Phase 3 only has to start populating `tax_amount` correctly, not restructure the entity. The remaining open question is narrower: whether `subtotal` means “net of tax” or “sum of line totals before tax”, which matters once a discount is applied.

### The `FINANCE_TAX_LINES` gap

The ERD (lines 265–271) defines `FINANCE_TAX_LINES { id, invoice_item_id, tax_name, tax_rate, tax_amount }`.

Like the ledger and the refund/credit-note tables, it **lacks `organization_id`** and needs the same approved addition as `InvoiceItem`. Note that `tax_name`/`tax_rate` are **denormalised onto the line**, which is correct for auditability: a tax line must record the rate *as applied at the time*, not a live lookup into a mutable rates table.

### The missing `membership_discounts` entity — a backlog inaccuracy

Task backlog P3-04 lists `membership_discounts table (completed in P1-03)`. **This is not true of the codebase.** Verified 2026-09-17:

- `src/memberships/entities/` contains only `membership.entity.ts`, `membership-plan.entity.ts`, `membership-history.entity.ts` — **there is no `MembershipDiscount` entity and no discount service.**
- `docs/database-plan.md` line 187 *does* define `MEMBERSHIP_MEMBERSHIP_DISCOUNTS { id, membership_id, discount_type, amount, starts_at, ends_at, created_at }`, but nothing implements it.
- The only existing “discount” logic in the repo is **inferred, not modelled**: `src/ai/services/plan-performance.service.ts` counts `discounted_signups` by comparing `Membership.price_at_signup` against the current plan price.

**Implication**: P3-04 is not merely “apply tax/discount on invoices”. If discounts must be first-class, `MEMBERSHIP_MEMBERSHIP_DISCOUNTS` has to be **built from scratch** — a Phase 3 deliverable, not a Phase 1 inheritance. This changes P3-04's size estimate and should be confirmed with the reviewer (§15 Q8). See also §14.5.

### Proposed entities

| Entity | Table | Key fields | Notes |
|--------|-------|-----------|-------|
| `TaxRate` | `FINANCE_TAX_RATES` (**new — not in the ERD**) | id, organization_id, name, code, rate, is_inclusive, is_active, effective_from, effective_to | The backlog says *“Potentially tax_rates table”*. `FINANCE_TAX_LINES` holds *applied* tax; a rates table holds *configurable* rates. Both are needed — §15 Q6. |
| `TaxLine` | `FINANCE_TAX_LINES` | id, invoice_item_id, organization_id, tax_name, tax_rate, tax_amount | Per-ERD + `organization_id`. Immutable audit record of tax applied. |
| `MembershipDiscount` | `MEMBERSHIP_MEMBERSHIP_DISCOUNTS` | id, membership_id, organization_id, discount_type, amount, starts_at, ends_at, created_at | **Not built in Phase 1** despite the backlog. Belongs to the Membership module, not Finance — see the ownership note below. |

### Module ownership: where does discounting live?

A real boundary decision: `MembershipDiscount` is a **membership** concept (it attaches to `membership_id`, and the ERD places it in the `MEMBERSHIP_` schema), yet P3-04 is a **finance** task. Two clean options:

- **Membership owns the discount definition; Finance owns its application.** `MembershipsModule` exposes the active discount for a membership; `InvoicesService` consumes it as a line-item adjustment. One-directional dependency, mirroring the existing `PT → WorkoutsService.assignPlan()` naming-collision resolution.
- **Finance owns everything.** Simpler to build, but puts a `MEMBERSHIP_`-prefixed table under finance ownership, contradicting the schema namespace.

**Recommended default (subject to §15 Q8)**: the first option — it respects the existing schema namespaces and the one-directional dependency convention already established in Phase 2.

### Order of operations: discount before or after tax

The backlog's acceptance criterion is *“Discounts applied before/after tax as configured”* — explicitly **configurable**, not fixed. The calculation order must therefore be a stored/configurable property rather than hard-coded. This is the core test case (“Combined tax and discount scenarios”) and the most error-prone part of P3-04. The arithmetic must be centralised in one function in `finance.constants.ts` next to `toMoney()` / `sumMoney()`, because those helpers already establish that all money arithmetic is rounded to 2 decimals in exactly one place.

### API surface (task backlog P3-04)

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `GET /v1/tax-rates` | `finance:read` | Org-scoped, paginated. |
| `POST /v1/tax-rates` | `finance:admin` (new action) | Backlog marks it “(admin)”. |
| `POST /v1/invoices` (enhanced) | `finance:create` (existing) | Now honours `line_items[].tax_code` and applies discounts. **Backwards compatibility**: callers that omit `tax_code` must still produce `tax_amount = 0.00`. |

### Event contracts

**No new events are strictly required.** `InvoiceCreated.v1` already carries `lineItems[].taxCode` and `totalAmount`, so tax detail flows through the existing contract. If per-line tax amounts must be published (rather than derivable from `taxCode`), that is a **contract version bump** (`InvoiceCreated.v2`), not a silent payload change — flag for the reviewer (§15 Q9).

### RBAC permissions

| Action | Rationale |
|--------|-----------|
| `finance:read` | Read tax rates (existing). |
| `finance:admin` | **New** — manage tax rates. Distinct from `finance:create`, because changing tax configuration is a compliance-sensitive action. |

### Phase 3+ dependencies

- **Blocks §5** — recurring billing must compute tax on renewal invoices.
- **Blocks §7** — retail inventory sales need tax on the point-of-sale invoice.
- **Depends on Membership module** for discount definitions (if option 1 above is chosen).
### Tax exemption

The backlog requires *“Tax-exempt members handled”*, but **no entity currently carries a tax-exempt flag** — `Member` has no `tax_exempt` column and `Organization` has no tax-exempt concept. Exemption could attach to the member (a non-profit or government member), to the organization (a tax-exempt gym), or to the line item (a zero-rated category such as some health products). This is genuinely undecided and materially affects both the DTO and the calculation, so it is raised as **§15 Q7** rather than assumed. Whichever is chosen, the applied result must still be recorded on `FINANCE_TAX_LINES` (a zero-rated line is a real audit row, not a missing one).

- **Risk**: tax calculation errors are a compliance issue (the backlog raises this directly) — see §14.4.

---

## 5. Finance Extensions — Recurring Billing & Dunning (P3-08 / P3-09)

> **Note on backlog numbering**: `docs/task-backlog.md` defines only P3-01 through P3-07, and places P3-03/P3-04 *after* P3-07. Recurring billing and dunning are **not separate backlog entries** — they exist as (a) the backdrop of P3-03 (“Failed payments retry appropriately”), (b) the pre-existing `payment-retry.worker.ts`, and (c) the Phase 1 `Membership.renewal_date` column. They are split out here as **P3-08 (Dunning)** and **P3-09 (Recurring Billing)** because they are distinct deliverables with different risk profiles.

### Domain context — the renewal path does not exist

This is the largest gap in Phase 3 finance, and it is easy to miss because the *data* is already in place:

| Artifact | State | Evidence |
|----------|-------|----------|
| `Membership.renewal_date` | Column exists, **populated at creation but never consumed** | `memberships.service.ts` line 398: `renewal_date: endDate, price_at_signup: plan.price, currency_at_signup: plan.currency` |
| `Membership.price_at_signup`, `currency_at_signup` | Stored (the price/currency to renew at), never read back | same line |
| `MembershipsService.renew()` | **Does not exist** | Full method list is `create`, `update`, `pause`, `resume`, `freeze`, `unfreeze`, `cancel`, `expire`, `expireDueMemberships`, `getCheckInEligibility`, `findAll/One/ByMember` |
| `MembershipExpiryWorker` + `expireDueMemberships()` | Built. Worker-only, spans orgs, row-locks each candidate, publishes `MembershipExpired.v1` exactly once. | `membership-expiry.worker.ts`; `memberships.service.ts` line 285 |
| `PaymentRetryService` | Built, retries `pending` payments, skipped when `isConfigured` is false | `payment-retry.service.ts` |

**The gap**: a membership can *expire* but there is **no code path that renews one, and no code path that bills for a renewal.** `renewal_date` is currently write-only data. P3-09 must build the entire renewal flow — a `renew()` service method, the invoice it produces, and the state transition — not merely wire an existing renewal into billing.

### The critical design tension: expiry vs renewal ordering

`MembershipExpiryWorker` currently **expires** memberships whose end date has passed, and `expireDueMemberships()` already holds a row lock and publishes exactly once. Recurring billing must decide how renewal interacts with that worker, and the options have materially different consequences:

| Option | Behaviour | Consequence |
|--------|-----------|-------------|
| **(a) Bill before expiry** | A new worker picks up memberships whose `renewal_date` is within N days and issues a renewal invoice *before* `MembershipExpiryWorker` fires. | The member never lapses while paying; requires a lead-time policy (N) and a decision on late payment. The expiry worker can still fire, so the two workers race over the same rows. |
| **(b) Renew on expiry** | `expireDueMemberships()` is enhanced to also issue a renewal invoice and extend the membership. | Reuses the existing row lock and exactly-once guarantee, so **no new race is introduced**. But it conflates “expired” with “renewed”, and a failed payment leaves the membership expired — arguably correct. |
| **(c) Hybrid** | Bill N days ahead; auto-charge with the saved payment method; expiry remains the fallback. | Best UX, most complexity. Needs saved payment methods (§15 Q10). |

**Recommended default (subject to §15 Q13)**: **(b) for the first pass, with (a) as a follow-up.** Option (b) is the only variant that reuses the existing exactly-once, row-locked expiry path and therefore adds no new concurrency surface. It also keeps the new worker’s responsibility honest: **dunning** (chasing unpaid invoices) is a separate concern from **billing** (creating them), and only dunning needs a new worker.

**Do not** implement (a) and (b) simultaneously without a shared lock: two workers driving the same membership risk double-issuing a renewal invoice. Any renewal path must inherit `expireDueMemberships()`’s pattern of re-validating each candidate under a row lock inside its own transaction.

### Proposed entities

| Entity | Table | Notes |
|--------|-------|-------|
| `DunningAttempt` (name TBD — §15 Q14) | `FINANCE_DUNNING_ATTEMPTS` (**new — not in the ERD**) | Tracks attempt number, channel, `scheduled_at`, `sent_at`, outcome per invoice/payment. The existing retry bookkeeping lives on `Payment` / `PaymentRetryService`; whether dunning needs its *own* table depends on §15 Q10. |
| Membership renewal record | Reuse `FINANCE_INVOICES.membership_id` (**no new table**) | A renewal invoice is just an invoice with `membership_id` set — the column already exists and is indexed. **Recommended**: no new table; the invoice *is* the renewal record. |

### Proposed workers

Both must follow the established `BackgroundWorker` contract exactly (`src/shared/workers/background-worker.ts`):

- Extend `BackgroundWorker` and implement `runOnce()`.
- Declare `workerName` + `workerInstanceKey`.
- Be **OFF by default** — `WORKERS_ENABLED` master switch plus a `WORKERS_<NAME>_ENABLED` override.
- Register defaults in `WORKER_INTERVALS` and `WORKER_BATCH_SIZES` in `worker-config.ts`.
- Ticks never overlap and never throw (`tick()` guards both, and a disabled worker is a no-op even when called directly).

| Worker | Name key | Suggested interval | Responsibility |
|--------|----------|-------------------|----------------|
| Dunning | `DUNNING` | daily | Scan overdue invoices, dispatch dunning notifications, escalate after max attempts. |
| Recurring billing | `RECURRING_BILLING` | daily | **Only if option (a)/(c) is chosen.** Under option (b) this worker is unnecessary — the expiry worker already drives the path. |

The existing `PAYMENT_RETRY` worker (15 min, batch 50) retries *pending payments*; dunning *communicates and escalates* about invoices still unpaid after retries. They are complementary, and the plan must state which one owns the max-attempts counter so two independent counters cannot disagree — §15 Q14.

### Dunning policy (reuse, do not reinvent)

`PAYMENT_RETRY_DEFAULTS` already defines `MAX_ATTEMPTS: 3`, `BATCH_SIZE: 50`, exponential backoff `BASE_DELAY_MS × 2^(attempt-1)` capped at `MAX_DELAY_MS`, via the exported `paymentRetryDelayMs(attempt)` helper. The backlog suggests *“3 attempts at [1, 3, 7] days”* — which is a **different shape** (a fixed schedule, not exponential). Either reuse `paymentRetryDelayMs()` or add a separate dunning schedule constant; **do not** hard-code `[1, 3, 7]` inline. See §15 Q10.

### API surface

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| *(none new required)* | — | Dunning is worker/notification-driven, not user-driven. |
| `POST /v1/invoices/{id}/payments` (existing) | `finance:record-payment` | The manual desk payment that clears a dunned invoice. |

If the reviewer wants staff-facing dunning controls (pause dunning for an invoice, force-escalate), that is new API surface not present in the backlog — §15 Q14.

### Event contracts

| Event | Payload (proposed) | Consumers |
|-------|--------------------|-----------|
| `InvoiceOverdue.v1` (**new**) | `{ invoiceId, memberId, organizationId, amountOutstanding, dueDate, daysOverdue }` | Dunning worker, notifications, Member 360 |
| `DunningEscalated.v1` (**new**) | `{ invoiceId, organizationId, attemptCount, escalatedAt }` | Notifications, staff dashboard |

Neither name appears in `docs/domain-map.md` or `docs/event-contracts.md` — both would be **net-new contracts** requiring the three-way lockstep update described in §2. Reuse of the existing `MembershipExpired.v1` for the renewal case avoids one new event.

### RBAC permissions

No new permissions. Dunning runs as a worker (no tenant context, cross-org scan) and reuses the existing `finance:read` / `finance:record-payment` for any staff-facing route.

### Phase 3+ dependencies

- **Depends on §3** — dunning cannot charge without a gateway, though notification-only dunning can ship before the gateway exists.
- **Depends on §4** — renewal invoices must carry tax.
- **Depends on §2** — a dunned invoice that is finally written off needs a credit note.
- **Feeds the Notifications phase** — dunning communication channels are P5 (Notifications) work; dunning should publish events and let the notification layer decide channels (see §15 Q14).
- **Risk**: worker infrastructure scaling — see §14.7.

---

## 6. Finance Extensions — Commission Payout & Clawback (Phase 2 extension)

### Domain context — half of this is pre-wired, half is not

Phase 2 built `TrainerCommission` as a deliberately *inert* row so Phase 3 could act on it. The two halves of that promise have very different readiness:

| Capability | Pre-wired by Phase 2? | Evidence |
|------------|----------------------|----------|
| **Clawback** (`earned → clawed_back`) | **Yes — no migration needed.** | `trainer-commission-status.enum.ts`: *“`pending`/`clawed_back` are pre-deployed so the Phase 3 finance flow (“earned → clawed_back” on cancellation/refund) needs no schema migration.”* The enum doc names this exact transition. |
| **Payout** (`earned → paid`) | **No.** | `TrainerCommission` has **no `paid` status** (only `pending`/`earned`/`clawed_back`) and **no `paid_at` / `paid_amount`** columns — the entity doc states they are *“absent, as §1 explicitly requires.”* |
| **Enrollment cancellation** | **No.** | `PTEnrollmentStatus.CANCELLED` exists but *“**No code path sets this in Phase 2**”* — it is “pre-deployed for the same reason as the 3-state commission status: the Phase 3 cancellation/refund flow then needs no schema migration.” |
| Commission computation | Yes. `amount = package.price × commission_percent / 100`, computed **once** at enrollment creation, never recalculated. | `trainer-commission.entity.ts` lines 18–20 |

**The key planning consequence**: **clawback is cheaper than payout.** Clawback is a pure status transition on an existing column, and its trigger (cancellation/refund) is already specified in the Phase 2 docs. Payout requires *new columns* (`paid_at`, `paid_amount`) and arguably a new status (`paid`) — i.e. a migration and an enum change that Phase 2 explicitly deferred. Treat them as **two deliverables**, and sequence clawback before payout.

### Two real blockers to flag

1. **`paid_at` / `paid_amount` were excluded by explicit instruction.** Adding them now contradicts the Phase 2 §1 requirement that they be absent. This is not an oversight to silently fix — the reviewer must confirm the reversal (§15 Q15). An alternative that avoids touching the entity at all is a separate payout-run table pair, leaving `TrainerCommission` untouched. That is **recommended**, because it preserves the Phase 2 invariant *and* models a bulk payout run properly: a run covers many commissions, and a single `paid_at` column cannot express which run paid which trainer.
2. **The one-row-per-enrollment unique index constrains clawback granularity.** `@Index(['pt_enrollment_id'], { unique: true })` means **one commission row per enrollment**, so a partial clawback cannot be expressed by inserting a second row. Either the status transition is all-or-nothing, or `amount` must be adjusted, or an adjustment line must live in the payout table. See §15 Q16.

### Proposed design

**Clawback (P3-11)**

- Trigger: `PTEnrollmentStatus.CANCELLED` — implemented for the first time, via a new `PtEnrollmentsService.cancel()` that holds the enrollment row lock, transitions the status, and in the **same transaction** sets the linked commission to `clawed_back`.
- **The write must live in the PT module, not finance.** The Phase 2 module doc makes single-write-path an explicit invariant (*“Nothing else in this module ever writes a `TrainerCommission`”*), so finance publishes/consumes an event and PT owns the write. This mirrors the existing one-directional `PT → WorkoutsService.assignPlan()` collision resolution.
- Audit trail preserved: status transition only, never deletion (Phase 2 explicitly requires “No deletion — audit trail is preserved”).

**Payout (P3-12)**

- Bulk payout run: an admin creates a payout run for a period; the run snapshots all `earned` commissions in scope and marks them paid on completion.
- **The status problem**: with no `paid` value, the run must either (a) add `paid` to `TRAINER_COMMISSION_STATUS_VALUES`, or (b) leave `status` at `earned` and let the payout table record payment. Option (b) leaves `status` unable to answer “has this been paid?” — precisely the question a payout report must answer. **Recommendation: add a `paid` status value.** It is additive and existing rows are unaffected (§15 Q15).

### Proposed entities

| Entity | Table | Notes |
|--------|-------|-------|
| `CommissionPayoutRun` | `PT_COMMISSION_PAYOUT_RUNS` (**new — not in the ERD**) | Payout header: period start/end, status, total amount, currency, created_by, processed_at. |
| `CommissionPayoutItem` | `PT_COMMISSION_PAYOUT_ITEMS` (**new — not in the ERD**) | Line per commission: payout_run_id, trainer_commission_id, amount, currency. |

Both are **net-new tables** — the ERD has no payout concept. The alternative (a nullable `payout_run_id` plus `paid_at`/`paid_amount` on `TrainerCommission`) achieves the same with one migration but contradicts the Phase 2 exclusion. Either way, **schema work is unavoidable for payout** — only clawback is migration-free.

### Event contracts — and a pre-existing documentation gap

| Event | Payload (proposed) | Status |
|-------|--------------------|--------|
| `TrainerCommissionClawedBack.v1` | `{ commissionId, enrollmentId, trainerId, organizationId, amount, currency, reason, clawedBackAt }` | **New.** Pairs with the existing `TrainerCommissionEarned.v1`. |
| `TrainerCommissionPaid.v1` | `{ commissionId, payoutRunId, trainerId, organizationId, amount, currency, paidAt }` | **New.** |

**Gap found while verifying**: `TrainerCommissionEarned.v1` is declared **only** in `src/pt/pt.constants.ts` and published through the outbox — it appears **nowhere in `docs/event-contracts.md`, and there is no `packages/contracts/src/events/pt.events.ts`.** The contracts package contains only `attendance.events.ts`, `finance.events.ts`, `workouts.events.ts`, `membership.events.ts` and `event-envelope.ts`. So Phase 3's new commission events would join a family that is **not yet a published contract**. Either formalise a `pt.events.ts` (recommended, matching how finance/membership/workouts are declared) or accept that PT events are backend-only.

**Naming-convention inconsistency to resolve**: `pt.constants.ts` uses versioned names (`'TrainerCommissionEarned.v1'`) while `finance.constants.ts` uses unversioned ones (`'InvoiceCreated'`) with the version carried separately by `FINANCE_EVENT_VERSION`. New PT events should follow the **PT module's existing convention** (version in the name) for local consistency, but the reviewer should decide whether the platform standardises on one form — §15 Q17.

### API surface

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `POST /v1/pt/enrollments/{id}/cancel` | `pt:delete` (existing — “Cancel enrollments”) | The permission already exists and is currently unimplemented. |
| `GET /v1/pt/commissions` | `pt:read` | Filter by trainer, status, period. |
| `POST /v1/pt/commission-payouts` | `pt:payout` (**new**) | Create/process a payout run. |
| `GET /v1/pt/commission-payouts/{id}` | `pt:read` | |

### RBAC permissions

| Action | Rationale |
|--------|-----------|
| `pt:delete` | **Already exists** in the permission vocabulary (“Cancel enrollments”) and finally gets an implementation. |
| `pt:payout` | **New** — running payroll is a materially different authority from reading commissions. |

### Phase 3+ dependencies

- **Depends on §2** — clawback is triggered by cancellation/refund, so the refund path must exist first.
- **Feeds §1** — payouts are ledger entries; the ledger must be able to represent them.
- **Loyalty note (Phase 2 §12 Q20)**: Phase 2 deferred loyalty *redemption* to “whenever finance integration exists”. Phase 3 is that integration, so the reviewer must decide whether redemption ships here — §15 Q18. `LoyaltyTransaction` already carries a `redeem` transaction type *“for Phase 3 compatibility”*, so the schema is ready, but `LoyaltyReward` remains schema-only with *“no redemption workflow”*. This is genuinely **optional scope** and is the first candidate to cut — see §14.6.

---

## 7. Retail Inventory (P3-05)

### Domain context

Inventory is a bounded context (`docs/domain-map.md` line 101): `inventory | inventory_items, inventory_transactions, inventory_lots, suppliers, purchase_orders`. Blocks known: *“InventoryItemCreated, InventoryStockUpdated, InventoryItemSold, PurchaseOrderReceived”*. The ERD (lines 562–606) defines five tables:

```
INVENTORY_INVENTORY_ITEMS       { id, organization_id, name, description, sku, category,
                                  unit_cost, retail_price, unit_of_measure, is_active }
INVENTORY_INVENTORY_TRANSACTIONS{ id, inventory_item_id, transaction_type, quantity,
                                  transaction_date, reference_id, reference_type }
INVENTORY_INVENTORY_LOTS        { id, inventory_item_id, lot_number, expiry_date, quantity }
INVENTORY_SUPPLIERS             { id, name, contact_person, phone, email, address }
INVENTORY_PURCHASE_ORDERS       { id, organization_id, supplier_id, order_date,
                                  expected_delivery, total_amount, status }
```

### Four schema problems that must be fixed before implementation

These are not stylistic — three of them are tenant-isolation defects.

| # | Problem | Severity | Fix |
|---|---------|----------|-----|
| 1 | **`INVENTORY_SUPPLIERS` has no `organization_id`.** | **Critical — cross-tenant data leak.** | Suppliers are per-gym business relationships. Without `organization_id`, every gym shares one supplier directory: gym A would see gym B's supplier names, contact people, phone numbers and emails. This must be added, with a composite index on (`organization_id`, `name`). |
| 2 | **`INVENTORY_INVENTORY_TRANSACTIONS` and `INVENTORY_INVENTORY_LOTS` have no `organization_id`.** | High — org-scoping requires a join. | Every other tenant table in Phase 1/2 carries `organization_id` (the Phase 1 `InvoiceItem` note calls this “the one approved addition to that spec”). Without it, listing transactions or lots requires joining through `inventory_items` to establish tenancy — the exact problem `TrainerCommission` cited when it added the column. |
| 3 | **`INVENTORY_PURCHASE_ORDERS` has no line items.** | High — the PO model is incomplete. | A PO has a `total_amount` but no `purchase_order_items` table, so no PO can record *what* was ordered. Receiving stock against a PO is then impossible to reconcile line by line. A `INVENTORY_PURCHASE_ORDER_ITEMS` table (po_id, inventory_item_id, quantity_ordered, quantity_received, unit_cost) is required. **This is a net-new table absent from the ERD.** |
| 4 | **No stock-level representation.** | Medium — design decision needed. | `INVENTORY_INVENTORY_ITEMS` has no `quantity_on_hand` column, so stock level must be either derived from transactions (consistent with the Phase 1 finance principle of never denormalising a derived balance) or maintained as a denormalised counter. See the recommendation below. |

Also missing: **`branch_id` on inventory items**. A multi-branch gym has per-branch stock. The ERD scopes items to the organization only, so all branches share one stock pool. Whether that is acceptable is a product question — §15 Q21.

### Stock level: derived or denormalised?

This is the central design decision for P3-05, and Phase 1 already set the precedent:

| Option | Consistency with existing patterns | Trade-off |
|--------|-----------------------------------|-----------|
| **Derived** — `SUM(quantity) FROM INVENTORY_INVENTORY_TRANSACTIONS` per item | **Matches** the finance principle: `invoice.entity.ts` states the amount paid is deliberately not denormalised so “the payments table stays the single source of truth and no schema column is invented.” | Cannot drift. Slower on large transaction volumes — but mirroring §1's approach, a **materialized view** can serve listing/report paths while the raw sum remains authoritative. |
| **Denormalised counter** — `quantity_on_hand` on the item, updated per transaction | Contradicts the finance precedent, and introduces drift risk (a crash between the two writes leaves stock wrong). | Fast reads; needs careful transactional discipline. |

**Recommended default (subject to §15 Q20)**: **derive, with a materialized view for list endpoints.** This is the only option consistent with the Phase 1 pattern, and §1 already establishes the materialized-view mechanism for exactly this situation. The recommendation is explicitly *not* to add a denormalised counter unless performance data proves it necessary.

> **Note**: the materialized views this section reuses are **in-code configured for a small fixed set of known views**, per the supersede note in §1. `docs/database-plan.md`'s `REPORTS_MATERIALIZED_VIEWS` registry-table sketch (line 715) is **not** the model to follow here — inventory stock views are defined by migration alongside the finance ones, not registered as rows at runtime.

### Costing method

The backlog's acceptance criteria require items “tracked with SKU, description, cost”, and lots exist with `quantity` and `expiry_date` — the combination implies **costing**, but the ERD stores no cost per lot (no `unit_cost` on `INVENTORY_INVENTORY_LOTS`). Without a per-lot cost, FIFO and specific-identification costing are impossible; only weighted average could be approximated from `unit_cost` on the item.

**Options**: (a) FIFO — requires adding `unit_cost` to the lot table; (b) weighted average — workable with the current columns; (c) specific identification — requires a serial/lot identifier on every transaction. **Deferred to §15 Q19.** This decision materially changes the schema, so it should be resolved **before** the migration is written, not after.

---

## 8. CRM — Lead Management (P3-06)

### Domain context

CRM is a bounded context (`docs/domain-map.md` line 97): `crm | leads, lead_sources, lead_stages, lead_activities, follow_ups, trials, visits, conversions`. Blocks known: *“LeadCreated, LeadContacted, LeadQualified, TrialStarted, VisitCompleted, MemberConverted, LeadLost”*. The domain map describes the flow as **`CRM -->|Feeds into| Members (as leads)`** and **`CRM -->|Uses| Scheduling (for trials)`**.

**Nothing CRM exists in the codebase.** Verified: `grep -rn 'MemberConverted|conversion|lead' src/` returns a single unrelated hit (a comment in `pt-sessions.service.ts`). There is no `src/crm/` directory, no entity, no module. This is a from-scratch build.

### The ERD's eight CRM tables

```
CRM_LEADS        { id, organization_id, branch_id, first_name, last_name, phone, email,
                   source, status, created_at, updated_at }
CRM_LEAD_SOURCES { id, name, description }
CRM_LEAD_STAGES  { id, name, description, sort_order }
CRM_LEAD_ACTIVITIES { id, lead_id, activity_type, occurred_at, notes, created_by }
CRM_FOLLOW_UPS   { id, lead_id, outcome, follow_up_date, completed_at }
CRM_TRIALS       { id, organization_id, branch_id, member_id, start_date, end_date, status }
CRM_VISITS       { id, organization_id, branch_id, member_id, visit_date }
CRM_CONVERSIONS  { id, lead_id, membership_id, conversion_date }
```

### Schema problems to resolve

| # | Problem | Notes |
|---|---------|-------|
| 1 | `CRM_LEAD_SOURCES` and `CRM_LEAD_STAGES` have **no `organization_id`** (nor any FK). | Defensible *if* they are **global reference tables** everyone shares, and it avoids duplicating a standard funnel per gym. But it means one gym cannot add a custom source without every other gym seeing it. Decide: global reference table (seed data) **or** org-scoped with a seed step per organization. |
| 2 | `CRM_LEADS` stores `source` as a **string**, while a `CRM_LEAD_SOURCES` table also exists. | Two competing representations of the same concept. Either `source` is a FK to `CRM_LEAD_SOURCES` (consistent) or the table is unused. Ambiguity will cause an inconsistency bug if not decided up front. |
| 3 | `CRM_LEAD_ACTIVITIES`, `CRM_FOLLOW_UPS` and `CRM_CONVERSIONS` have **no `organization_id`**. | Same tenant-scoping issue as inventory: listing requires a join through `leads`. Add the column, consistent with every other Phase 1/2 tenant table. |
| 4 | `CRM_LEADS.status` is a free string with **no enum defined anywhere**. | The funnel stages live in `CRM_LEAD_STAGES` (a table) *and* `status` (a column) — again two representations. Decide which owns the funnel, and define the value set as a const/enum in the CRM module (mirroring `INVOICE_STATUS` / `PT_ENROLLMENT_STATUS`). |
| 5 | `CRM_CONVERSIONS` links `lead_id → membership_id`, but a lead becomes a **member** first. | There is no `member_id` on `CRM_CONVERSIONS`. If conversion creates both a member and a membership, the conversion record should reference the member too — otherwise “which member did this lead become?” is unanswerable from the conversion row alone. |
| 6 | No `crm_prospects` concept, and no lead→member link on `CRM_LEADS` itself. | Once converted, nothing on the lead points at the resulting member. See §15 Q22. |

### The conversion flow — the highest-risk integration point

The domain map says CRM **“Feeds into Members”**, and the backlog lists `POST /v1/leads/{id}/convert` with the acceptance criterion *“Leads can be converted to members”* and *“Trial memberships created”*. This is the one place where CRM writes into an existing Phase 1 module, and it must respect that module's invariants:

- **`MembersService.create()` must be the only writer of a member.** CRM must **call the exported service**, never its own repository — the same one-directional pattern as `PT → WorkoutsService.assignPlan()`.
- The conversion must be **transactional**: marking the lead converted and creating the member/membership must not partially apply.
- **Idempotency matters**: a double-submitted convert request must not create two members. The existing `Payment.idempotency_key` pattern is the precedent.

**Unresolved**: whether conversion creates the member immediately, a prospect record, or a member without a plan — **§15 Q22** — and what happens if the member already exists (matched by phone/email) — **§15 Q23**.

### Scheduling dependency — a real blocker for trials

The domain map states CRM **“Uses Scheduling (for trials)”**, and the backlog requires trial memberships. **The Scheduling module does not exist** — Phase 2 explicitly deferred the “Services” tab and group-class booking because “the Scheduling module does not exist yet”. If trials require scheduled sessions, CRM's trial flow depends on a module that is not in Phase 3 scope. **Mitigation**: scope P3-06 trials to *trial membership periods* (`CRM_TRIALS.start_date`/`end_date`) with no scheduled sessions, and defer any session-booking integration. Flag for the reviewer.

### Proposed entities (new module: `src/crm/`)

| Entity | Table | Key fields | Notes |
|--------|-------|-----------|-------|
| `Lead` | `CRM_LEADS` | id, organization_id, branch_id, first_name, last_name, phone, email, source, status, created_at, updated_at | Per-ERD. Add `member_id` (nullable FK) to record the conversion target — schema problem 6. |
| `LeadSource` | `CRM_LEAD_SOURCES` | id, name, description (+ organization_id, pending decision) | Global-vs-org-scoped unresolved (schema problem 1). |
| `LeadStage` | `CRM_LEAD_STAGES` | id, name, description, sort_order (+ organization_id, pending decision) | Same. |
| `LeadActivity` | `CRM_LEAD_ACTIVITIES` | id, lead_id, organization_id, activity_type, occurred_at, notes, created_by | `organization_id` added. |
| `FollowUp` | `CRM_FOLLOW_UPS` | id, lead_id, organization_id, outcome, follow_up_date, completed_at (+ SLA fields, §9) | `organization_id` added. Extended in §9. |
| `Trial` | `CRM_TRIALS` | id, organization_id, branch_id, member_id, start_date, end_date, status | Per-ERD. Trial *period*, not scheduled sessions (see above). |
| `Visit` | `CRM_VISITS` | id, organization_id, branch_id, member_id, visit_date | Per-ERD. **Flag**: this appears to overlap the Attendance module's records — potential redundant data. |
| `Conversion` | `CRM_CONVERSIONS` | id, lead_id, organization_id, membership_id, **member_id (add)**, conversion_date | Per-ERD + additions (schema problems 3 and 5). |

### Module boundary rules (mirroring the PT/Workouts precedent)

1. **`CrmModule` exports services, never repositories.** Same encapsulation as `PtModule` — no other module can bypass CRM's invariants.
2. **CRM owns no member or membership table.** `MembersModule` and `MembershipsModule` are imported; `MembersService.create()` performs the write. One-directional (`CRM → Members`), matching the domain-map arrow exactly.
3. **The lead status funnel transitions in one place.** A single service method owns lead state changes so the funnel cannot be advanced by two code paths — mirroring `VALID_INVOICE_TRANSITIONS` and `PT_ENROLLMENT_STATUS_VALUES` as the canonical home for the value set.

### Event contracts

| Event | Payload (proposed) | Trigger |
|-------|--------------------|---------|
| `LeadCreated.v1` | `{ leadId, organizationId, branchId, source, status, createdAt }` | Lead created |
| `LeadContacted.v1` | `{ leadId, organizationId, activityId, activityType, occurredAt }` | Activity logged |
| `LeadQualified.v1` | `{ leadId, organizationId, stage, qualifiedAt }` | Stage → qualified |
| `TrialStarted.v1` | `{ trialId, leadId, memberId, organizationId, startDate, endDate }` | Trial period begins |
| `VisitCompleted.v1` | `{ visitId, memberId, organizationId, branchId, visitDate }` | Visit recorded |
| `MemberConverted.v1` | `{ conversionId, leadId, memberId, membershipId, organizationId, conversionDate }` | Lead converted |
| `LeadLost.v1` | `{ leadId, organizationId, reason, lostAt }` | Lead marked lost |

All seven names are **reserved in `docs/domain-map.md` (lines 97 and 143) but absent from `docs/event-contracts.md`, and there is no `packages/contracts/src/events/crm.events.ts`.** Each needs the three-way lockstep update (§2): contracts package, backend `crm.constants.ts` mirror, and the contracts doc. The backend deliberately does not import the contracts package at build time (`rootDir` is `./src`), so the mirror is mandatory, not optional.

### API surface (task backlog P3-06 + `docs/api-plan.md` lines 79–85)

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `GET /v1/leads` | `crm:read` | Paginated, filterable. |
| `POST /v1/leads` | `crm:create` | |
| `GET /v1/leads/{id}` | `crm:read` | |
| `PATCH /v1/leads/{id}` | `crm:update` | |
| `POST /v1/leads/{id}/activities` | `crm:update` | Log an activity. |
| `POST /v1/leads/{id}/follow-ups` | `crm:update` | Schedule a follow-up. |
| `POST /v1/leads/{id}/convert` | `crm:convert` (**new action**) | The high-risk route — it writes into the Members module. |
| `GET /v1/leads/{id}/trials` | `crm:read` | |

**Permission-naming discrepancy to note**: `docs/domain-map.md` (line 143) names CRM permissions in PascalCase style (`CRMView`, `CRMCreate`, `CMREdit`), as it does for Finance (`FinanceView`, `FinanceCreate`, `FinanceApprove`) and Inventory (`InventoryView`, `InventoryManage`). The **implemented** convention is `@RequirePermissions({ resource: 'crm', action: 'read' })` with a lowercase resource and a kebab-case action (confirmed by `resource: 'ai', action: 'retention-analysis'`). **The code convention is authoritative**; the domain-map names are aspirational. `crm:convert` is a genuinely new action because conversion writes into another module.

### RBAC permissions

| Action | Rationale |
|--------|-----------|
| `crm:read` | **New resource token.** `crm` does not exist in the current vocabulary (`ai`, `attendance`, `branch`, `diet`, `finance`, `measurement`, `member`, `membership`, `membership-plan`, `organization`, `pt`, `tenant-settings`, `workout`). |
| `crm:create` / `crm:update` | Standard CRUD. |
| `crm:convert` | **New** — because conversion creates a member, it is a cross-module write and deserves its own authority. |

### Workers

| Worker | Name key | Notes |
|--------|----------|-------|
| Lead nurturing | `CRM_NURTURING` | Backlog: “Lead nurturing worker (automated follow-ups)”. Must extend `BackgroundWorker` (§5). |
| Follow-up scheduler | `CRM_FOLLOW_UPS` | Backlog: “Follow-up scheduler worker”. Detailed in §9. |

Per §14.7, both must register defaults in `WORKER_INTERVALS` / `WORKER_BATCH_SIZES` and be OFF by default.

### Phase 3+ dependencies

- **`CrmModule → MembersModule`** for `MembersService.create()`.
- **`CrmModule → MembershipsModule`** for trial/plan creation — **only if** §15 Q22 resolves in favour of creating a membership automatically.
- **Blocked by Scheduling** for scheduled trial sessions (mitigated above).
- **Feeds §14.3** — the conversion → membership-plan assignment risk.
- **Publishes events consumed by the Notifications phase** (P5) for lead follow-up messages.

---

## 9. CRM — Follow-ups & SLAs (P3-07)

### Domain context

P3-07 depends on P3-06 and extends it. The backlog specifies:

- **Enhance `follow_ups` table with SLA fields.**
- **Create `sla_policies` table.**
- **Create `sla_breaches` table.**

**Neither `CRM_SLA_POLICIES` nor `CRM_SLA_BREACHES` exists in the ERD** (grep confirms no `SLA_` table anywhere in `docs/database-plan.md`), so both are **net-new tables** requiring their own ERD update as well as a migration. That is worth calling out: P3-07 is not purely an enhancement of an ERD-defined table — two thirds of its schema is undocumented. **Naming**: the backlog calls these `sla_policies` / `sla_breaches` (the two bullets above quote it verbatim); this plan and §12.3 use the ERD/constant names `CRM_SLA_POLICIES` / `CRM_SLA_BREACHES`, consistent with the existing `CRM_FOLLOW_UPS`. Same tables.

### Proposed entities

| Entity | Table | Key fields | Notes |
|--------|-------|-----------|-------|
| `SlaPolicy` | `CRM_SLA_POLICIES` (**new — not in the ERD**) | id, organization_id, name, applies_to (lead stage/source), first_response_hours, follow_up_interval_hours, escalation_after_hours, is_active | Defines the target timings. Org-scoped, because SLAs differ per gym. |
| `SlaBreach` | `CRM_SLA_BREACHES` (**new — not in the ERD**) | id, organization_id, sla_policy_id, lead_id, follow_up_id (nullable), breached_at, breach_type, escalated_at, resolved_at | The audit record of a missed target. Immutable history — breaches are never deleted. |
| `FollowUp` (extended) | `CRM_FOLLOW_UPS` | + `organization_id`, `due_at`, `sla_policy_id` (nullable), `sla_status`, `escalated_at` | The backlog's “SLA fields”. `follow_up_date` and `completed_at` already exist. |

### SLA fields on `CRM_FOLLOW_UPS` — design caution

`CRM_FOLLOW_UPS` currently has `follow_up_date` and `completed_at` but **no `created_at`**, which is a problem for SLA calculation: “was this follow-up overdue?” requires knowing *when it was scheduled*, not just when it is due. Either add `created_at` (a `@CreateDateColumn` consistent with every other entity in the codebase) or compute overdue-ness purely from `follow_up_date` vs now — but the latter cannot distinguish a follow-up scheduled late from one scheduled on time. **Recommendation: add `created_at`**, matching the codebase convention.

### Escalation and the permission boundary

Escalation is a **state change plus a notification plus an audit row**. Keeping it to one write path matters, so the SLA monitor should call a single service method (`escalateBreach()`) that writes the breach row, updates the follow-up, and publishes the event in one transaction — the same shape as the existing single-write-path services.

### Workers

| Worker | Name key | Responsibility | Backlog reference |
|--------|----------|----------------|------------------|
| Follow-up scheduler | `CRM_FOLLOW_UPS` | Generate follow-ups per policy; surface due/overdue ones. | “Follow-up scheduler worker (enhanced)” |
| SLA monitor | `CRM_SLA_MONITOR` | Detect breaches, escalate, write `CRM_SLA_BREACHES`. | “SLA monitoring worker” |

Both extend `BackgroundWorker` (§5) and are OFF by default. **Two new worker name keys** to register in `worker-config.ts`. Note this brings the Phase 3 worker count to **five candidates** (Dunning, Recurring Billing, CRM Nurturing, CRM Follow-ups, CRM SLA monitor) on top of three existing workers — the scaling concern in §14.7.

### API surface (task backlog P3-07)

| Endpoint | Permission | Notes |
|----------|-----------|-------|
| `GET /v1/follow-ups/due` | `crm:read` | Due and overdue follow-ups. |
| `POST /v1/follow-ups/{id}/complete` | `crm:update` | Records `outcome` + `completed_at`. |
| `GET /v1/sla/reports` | `crm:read` (or **new** `crm:report`) | Compliance reporting — mirrors the §1 `finance:report` question. |
| SLA policy CRUD (not listed in the backlog) | — | **Missing from the backlog**: `CRM_SLA_POLICIES` is a planned net-new table (entity table above; no migration written yet), but no endpoint is specified to manage it — the three P3-07 endpoints listed in the backlog include none for policies. Without a configuration API, policies can only be seeded. Flag as a scope gap — see §15.1. |

### Event contracts

| Event | Payload (proposed) | Trigger |
|-------|--------------------|---------|
| `FollowUpScheduled.v1` | `{ followUpId, leadId, organizationId, dueAt, slaPolicyId }` | Follow-up created |
| `FollowUpCompleted.v1` | `{ followUpId, leadId, organizationId, outcome, completedAt }` | Follow-up completed |
| `SlaBreached.v1` | `{ breachId, leadId, organizationId, slaPolicyId, breachType, breachedAt }` | SLA missed |
| `SlaEscalated.v1` | `{ breachId, leadId, organizationId, escalatedAt }` | Escalation raised |

**All four are net-new** — they appear in neither the domain map's event blocks nor `event-contracts.md`. Adding four more CRM events on top of §8's seven gives CRM **eleven** events to declare across three artifacts.

### RBAC permissions

| Action | Rationale |
|--------|-----------|
| `crm:read` / `crm:update` | Reused from §8. |
| `crm:report` | **Optional new** — SLA compliance reporting, mirroring `finance:report` (§15 Q3). |

### Scope risks called out by the backlog itself

The backlog names two risks for P3-07 that are worth surfacing as product risks rather than engineering ones:

- **“Follow-up fatigue”** — automated follow-ups that fire too often damage the member relationship. The policy model must support a cap (max follow-ups per lead per period), not just an interval.
- **“SLA gaming”** — staff could close follow-ups without real contact to avoid breaches. The `outcome` field is the only guard; if this matters, require a substantive outcome or an activity link before `complete` counts as on-time.

### Phase 3+ dependencies

- **Depends on P3-06** (backlog states this directly).
- **Feeds the Notifications phase** (P5) — escalation notifications are P5 work.
- **`crm:report`** decision overlaps §15 Q3.

---

## 10. Storage Configuration (P3-10 — Phase 3 gap)

### What exists today

| Artifact | Path | State |
|----------|------|-------|
| `S3Module` | `src/shared/storage/s3.module.ts` | Providers + exports `S3Service`. |
| `S3Service` | `src/shared/storage/s3.service.ts` | `upload()`, `delete()`, `buildKey()`. |
| `@aws-sdk/client-s3` | `package.json` line 44 (`^3.1132.0`) | **Declared dependency** — no install needed. |
| Consumers | `src/members/members.module.ts` line 44 | **Only `MembersModule` imports `S3Module`.** |

`S3Service` is a clean provider seam in the same spirit as `PAYMENT_GATEWAY`: in non-production it writes to the local filesystem, and in production it dynamically imports the AWS SDK. The development fallback is deliberate and documented.

### The three concrete gaps

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 1 | **`S3Module` is not globally available.** | Only `MembersModule` imports it (`members.module.ts` line 44). | CRM lead attachments and inventory item images cannot use storage without either importing `S3Module` in each new module or making it global. |
| 2 | **`S3Service.buildKey()` is hard-coded to member documents.** | Signature `buildKey(organizationId, memberId, uuid, fileName)` returns `orgs/{orgId}/members/{memberId}/documents/{uuid}/{fileName}` (the Phase 2 Q25 convention). | It requires a `memberId`, so it **cannot build a key for a CRM lead attachment or an inventory item image**. New key builders are needed. |
| 3 | **No S3 environment variables are documented.** | `S3Service` reads `process.env.S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET` and `AWS_REGION` — **none appear in `.env.example`** (verified: zero matches for `s3`/`aws`/`bucket`/`storage`/`upload`). | A production deployment silently falls back to the bucket `gym-documents` in `us-east-1` with no configuration surface. This is the actual “Phase 3 Storage Configuration” gap. |

A fourth, minor inconsistency: `S3Service` reads `process.env` **directly**, whereas the workers use NestJS `ConfigService` (`BackgroundWorker` injects it). If a module wants a configured bucket per environment, it should follow the `ConfigService` pattern for consistency with `worker-config.ts` / `configService.get(...)`.

### Recommendations

1. **Add domain-specific key builders rather than generalising `buildKey()`.** Keep the existing member path working (it is covered by `documents.service.spec.ts`), and add e.g. `buildCrmAttachmentKey()` (`orgs/{orgId}/crm/leads/{leadId}/{uuid}/{fileName}`) and `buildInventoryImageKey()`. Changing the existing signature would break the Phase 2 tests that assert `buildKey` is called with exactly four arguments.
2. **Make the module reusable.** Either annotate `S3Module` with `@Global()`, or introduce a `SharedModule` that re-exports `S3Module` plus any other cross-cutting provider. `@Global()` is the smaller change; a `SharedModule` is more explicit and is the better long-term shape if more shared providers arrive.
3. **Document the configuration** in `.env.example`: `S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET`, `AWS_REGION`. This is a one-file change with outsized operational value — without it, production storage configuration is discoverable only by reading the service source.
4. **Preserve the S3/DB ordering decision.** `s3.service.ts` documents “S3 upload FIRST, DB insert SECOND” (an unreferenced orphan object is acceptable; a DB row pointing at a missing object is not). Any new storage consumer must follow the same order and keep the best-effort `delete()` cleanup on DB failure.

### Scope note

Storage is **not a critical-path blocker** for Phase 3. CRM lead attachments and inventory item images can be deferred without blocking P3-05/P3-06, because neither appears in the backlog's acceptance criteria for those tasks. P3-10 should therefore be scheduled opportunistically rather than as a prerequisite — see §12.

### Files to change

| File | Change |
|------|--------|
| `src/shared/storage/s3.service.ts` | Add `buildCrmAttachmentKey()` / `buildInventoryImageKey()`; optionally switch to `ConfigService`. |
| `src/shared/storage/s3.module.ts` | `@Global()` (or export via `SharedModule`). |
| `.env.example` | Add the three S3 variables. |
| `src/crm/crm.module.ts`, `src/inventory/inventory.module.ts` | Import storage (or rely on `@Global()`). |

---

## 11. Existing Pattern Application Summary

Every Phase 3 module should be visibly a citizen of the existing codebase. The table maps each established pattern to its Phase 3 application, with the Phase 1/2 source that establishes it.

| Pattern | Established by (Phase 1/2) | Phase 3 application |
|---------|---------------------------|---------------------|
| **Single write path per entity** | `PtEnrollmentsService.create()` writes enrollment + commission + outbox in one transaction; `PtModule` doc: “Nothing else in this module ever writes a `TrainerCommission`.” | `RefundsService.create()` writes refund + ledger row + outbox in one transaction. `CreditNotesService.create()` likewise. Commission clawback stays in `PtEnrollmentsService`. |
| **Modules export services, never repositories** | `PtModule` exports only its five services; `WorkoutPlanAssignment` is deliberately *not* registered in `forFeature` to prevent a parallel write path. | `InventoryModule` exports `InventoryItemsService`; `CrmModule` exports `LeadsService`. No repository is exported from any new module. |
| **One-directional cross-module calls with a named collision resolution** | `PT → WorkoutsService.assignPlan()` (documented “naming-collision resolution: one-directional”). | `CRM → MembersService.create()`; the Finance/Membership discount boundary (§4); `PT → FinanceModule` for payouts. Each must be documented as one-directional. |
| **Tenant scoping via `TenantContextService`** | Every service injects it; org is never read from the request body/query (stated in `invoices.controller.ts`). | All new services inject `TenantContextService`. Raw SQL in §1 views is explicitly `WHERE organization_id = $1`. |
| **`organization_id` on every tenant table** | Added to `InvoiceItem` and `TrainerCommission` as documented deviations from the ERD. | Add to `FINANCE_TAX_LINES`, `FINANCE_REFUNDS`, `FINANCE_CREDIT_NOTES`, `FINANCE_FINANCIAL_LEDGER`, all `INVENTORY_*` tables, and the CRM tables lacking it (§7, §8). |
| **State value sets live in a domain constants file** | `INVOICE_STATUS`, `PAYMENT_STATUS`, `VALID_INVOICE_TRANSITIONS` in `finance.constants.ts`; `PT_ENROLLMENT_STATUS_VALUES`, `TRAINER_COMMISSION_STATUS_VALUES`. | `REFUND_STATUS`, `CREDIT_NOTE_STATUS` in `finance.constants.ts`; lead-status funnel in `crm.constants.ts`; inventory transaction types in `inventory.constants.ts`. |
| **Money arithmetic centralised + rounded once** | `toMoney()` / `sumMoney()` in `finance.constants.ts` (“every arithmetic result is rounded back to 2 decimals before it is stored”), `NUMERIC(15,2)`. | Tax/discount calculation added beside them. Inventory `unit_cost`/`retail_price` and payout amounts reuse them. |
| **Outbox events published in the writing transaction** | `PtEnrollmentsService.create()` publishes `PTEnrollmentCreated.v1` + `TrainerCommissionEarned.v1` in the same transaction. | Every new write path publishes its event through `OutboxService` in the same transaction. |
| **Event names mirrored in three places** | `finance.constants.ts` warns it “MUST stay in lockstep” with `packages/contracts` and `docs/event-contracts.md`; the backend does not import contracts (`rootDir` is `./src`). | Every new finance/inventory/CRM/PT event must be added to the contracts package, a backend constants mirror, and the contracts doc. |
| **RBAC via `@RequirePermissions({ resource, action })`** | Lowercase resource + kebab action (e.g. `resource: 'finance', action: 'record-payment'`). | `inventory:*`, `crm:*` resource tokens added; `finance:refund` / `finance:credit-note` / `finance:admin` / `pt:payout` actions added. |
| **Provider seam with a no-op default** | `PAYMENT_GATEWAY` + `UnavailablePaymentGateway` (`isConfigured = false`). | The Stripe/provider adapter replaces the binding without changing the worker or the contracts. |
| **Workers extend `BackgroundWorker`, OFF by default** | `MembershipExpiryWorker`, `PaymentRetryWorker`; `WORKERS_ENABLED` master switch + `WORKERS_<NAME>_ENABLED`; non-overlapping, never-throwing ticks. | Dunning, CRM nurturing, CRM follow-ups, CRM SLA monitor (+ recurring billing if chosen) extend it and register in `worker-config.ts`. |
| **Workers re-validate under a row lock in their own transaction** | `expireDueMemberships()`: “re-validates every candidate under a row lock in its own transaction, and publishes `MembershipExpired.v1` exactly once.” | Dunning and any renewal path must inherit this; a worker scan must never trust its candidate list. |
| **Derived figures are not denormalised** | “The amount actually paid is NOT denormalised here… the payments table stays the single source of truth and no schema column is invented.” | Ledger figures (§1) and inventory stock levels (§7) are derived; materialized views serve reporting. |
| **Idempotency via a unique key** | `Payment.idempotency_key UK`; the backlog ties P3-03 to P0-06. | Gateway webhook events stored with a unique provider event id (§3); lead conversion idempotent (§8). |
| **Audit over deletion** | Commission clawback is a status transition: “No deletion — audit trail is preserved.” | Refunds, credit notes, SLA breaches and payout runs are append-only history. |
| **Migrations under `src/migrations/`** | e.g. `1788965263234-CreateFinanceSchema.ts`, `1788965263250-AddLoyaltySchema.ts`; **permissions also have their own migrations** (`-ProvisionFinancePermissions.ts`, `-ProvisionPtPermissions.ts`). | New migrations follow `<timestamp>-<PascalCaseDescription>.ts`, and **each new permission set needs its own `Provision*Permissions` migration** — see §12.3. |

---

## 12. Proposed Build Order

### 12.1 Dependency-ordered sequence

**Wave 1 — Finance foundations (unblocks everything else)**

| Order | Task | Why here |
|-------|------|---------|
| 1 | **P3-01 Financial Ledger read model** (§1) | No entity changes — only views + a read service. Lowest risk, and it validates the materialized-view mechanism that inventory will reuse. |
| 2 | **P3-04 Tax & discounts** (§4) | Must precede recurring billing and inventory sales. Also unblocks the `membership_discounts` build. |
| 3 | **P3-02 Refunds & credit notes** (§2) | Depends on tax (credit-note tax reversal); closes the three Phase 1 “out of scope” escape hatches. |
| 4 | **P3-03 Payment gateway** (§3) | Prerequisite for gateway refunds and all real dunning. The seam exists, so the work is an adapter + webhook idempotency. |

**Wave 2 — Finance automation (depends on Wave 1)**

| Order | Task | Why here |
|-------|------|---------|
| 5 | **P3-08 Dunning** (§5) | Needs the gateway to charge and tax-correct invoices to chase. |
| 6 | **P3-09 Recurring billing / renewal** (§5) | Needs invoices + tax + payment. Builds the **missing** `renew()` path. |
| 7 | **P3-11 Commission clawback** (§6) | Needs refunds/cancellation. **Migration-free** — only a status transition. |
| 8 | **P3-12 Commission payout** (§6) | Needs the ledger and a payout schema decision (§15 Q15). |

**Wave 3 — Independent domains (parallelisable)**

| Order | Task | Why here |
|-------|------|---------|
| 9 | **P3-05 Retail Inventory** (§7) | Independent of finance except that PO costing references the ledger. **Resolve the four schema defects (§7) before writing the migration.** |
| 10 | **P3-06 CRM lead management** (§8) | Independent of finance. Only cross-dependency is lead conversion → `MembersService.create()`, which already exists. |
| 11 | **P3-07 CRM follow-ups & SLAs** (§9) | Depends on P3-06 (the backlog states this). |
| 12 | **P3-10 Storage configuration** (§10) | Opportunistic; not a blocker. |

### 12.2 Sequencing rules

- **Inventory and CRM are mutually independent** and can be built in parallel once Wave 1 lands.
- **P3-04 before P3-09 is non-negotiable** — renewing a membership without tax produces non-compliant invoices.
- **P3-03 before P3-08 is a soft dependency** — notification-only dunning can ship earlier; charge-retry dunning cannot.
- **Do not start P3-05 until §15 Q19 (costing) is answered**, because the answer changes the schema.
- **P3-11 (clawback) is the cheapest finance win in the phase**: one status transition, no migration. Good candidate for an early, low-risk merge.

### 12.3 Documentation and permission prerequisites (must precede code)

**Permission migrations** — the codebase provisions permissions through dedicated migrations (`-ProvisionFinancePermissions.ts`, `-ProvisionPtPermissions.ts`, and so on). Phase 3 therefore needs new provision migrations for: `inventory:*` (new resource), `crm:*` (new resource), `finance:refund`, `finance:credit-note`, `finance:admin`, and `pt:payout`. These are easy to forget because they are not schema changes.

**Documentation** — Phase 3 cannot be built honestly without first bringing the planning docs in line with reality:

1. `docs/event-contracts.md` — add every new event (§2, §3, §5, §6, §8, §9). The finance section currently documents only three Phase 1 events.
2. `docs/database-plan.md` — add `organization_id` to the tables that lack it; add `FINANCE_TAX_RATES`, `INVENTORY_PURCHASE_ORDER_ITEMS`, `CRM_SLA_POLICIES`, `CRM_SLA_BREACHES`, and the payout representation **whichever §15 Q15 selects** (a `PT_COMMISSION_PAYOUT_RUNS` / `PT_COMMISSION_PAYOUT_ITEMS` table pair, or `payout_run_id` + `paid_at` + `paid_amount` columns on `TrainerCommission` — option (b) adds no table, so this item must not presume the table pair); add missing columns (`created_at` on `CRM_FOLLOW_UPS`).
3. `packages/contracts/src/events/` — add `crm.events.ts`, `inventory.events.ts`, and (recommended) `pt.events.ts`.
4. `docs/task-backlog.md` — correct **all four** false “completed in P1” annotations, not just the one §4 found: `refunds` and `credit_notes` (both claimed “completed in P1-04”, lines 410–411), `tax_lines` (“completed in P1-04”, line 1293) and `membership_discounts` (“completed in P1-03”, line 1295). §14.5 records the verification. Also add the two missing Phase 3 entries — recurring billing and dunning have **no backlog item at all** — and renumber the out-of-order P3-03/P3-04 entries (they appear *after* P3-07).

---

## 13. Cross-Domain Dependencies

Inter-module wiring required when Phase 3 modules are added to `AppModule`. Direction is stated explicitly because the codebase requires **one-directional** dependencies with a named resolution.

| Consumer | Provider | Type | Notes |
|----------|----------|------|-------|
| `FinanceModule` | `TenantContextService` | Injection | Already imported (Phase 1). |
| `FinanceModule` | `PAYMENT_GATEWAY` | Injection seam | Already provided (`UnavailablePaymentGateway`); §3 rebinds it. |
| `FinanceModule` | `OutboxModule` | Import | Already used for the three Phase 1 events. |
| `FinanceModule` | `MembersModule` | **New import** | For `GET /v1/members/{id}/outstanding-balance` (§1) — member validation. |
| `FinanceModule` | `MembershipsModule` | **New import** | For recurring billing on renewal (§5). Likely needs `forwardRef`, matching the existing `MembersModule ↔ MembershipsModule` cycle handling. |
| `FinanceModule` | Membership discount lookup | **New, direction TBD** | §4 Q8: Membership owns the discount definition, Finance applies it. |
| `InventoryModule` | `TenantContextService` | Injection | Org-scoped inventory. |
| `InventoryModule` | `FinanceModule` | Import | PO costing references the ledger (soft — can be deferred). |
| `InventoryModule` | `S3Module` | Import | Item images (§10). |
| `CrmModule` | `TenantContextService` | Injection | Org-scoped CRM. |
| `CrmModule` | `MembersModule` | **New import** | `MembersService.create()` on lead conversion (§8). |
| `CrmModule` | `MembershipsModule` | Import **if** §15 Q22 says yes | To create the trial membership at conversion. |
| `CrmModule` | `S3Module` | Import | Lead attachments (§10). |
| `PtModule` | `FinanceModule` | **New import** | Commission payout writes ledger entries (§6). |
| `PtModule` | Finance refund/cancellation events | Consumer | Clawback trigger (§6). |
| `PtModule` | `OutboxModule` | Import | Already used for `TrainerCommissionEarned.v1`. |
| `LoyaltyModule` | `FinanceModule` | Consumer (**optional**) | Awarding/redeeming points on invoice payment — only if §15 Q18 says yes. |
| `MembershipsModule` | `FinanceModule` | **New import** | §5: expiry/renewal issues a renewal invoice. Direction and cycle handling must be decided (§15 Q13). |

**Cycle caution**: `MembershipsModule` already participates in a `forwardRef` cycle with `MembersModule`. Adding `MembershipsModule ↔ FinanceModule` alongside `FinanceModule → MembershipsModule` risks a **second cycle**. Prefer **event-driven** coupling (Finance publishes `PaymentSucceeded.v1`; Membership consumes it) over direct injection where a cycle would otherwise form — the outbox already exists for exactly this. The `MembersModule ↔ PtModule` and `MembersModule ↔ MembershipsModule` `forwardRef` usages are the precedent for what to avoid.

---

## 14. Scope Risks & Underspecified Areas

### 14.1 Financial period closing (regulatory risk)

If the platform is used where accounting periods must be closed (lock January's transactions on 1 February), the ledger design must support period locking. Without it, backdated entries could silently alter closed-period reports. **No Phase 1/2 entity has a period field**, and no lock concept exists anywhere in the codebase. This is a design decision, not an oversight — **deferred to §15 Q2**. If the answer is “yes, required”, it should land in **P3-01** alongside the ledger rather than as a later retrofit, because retrofitting period locks onto a live ledger means auditing historical entries.

### 14.2 Multi-currency (inventory purchasing + commissions)

The design assumes **the organization's currency** for all transactions. Two places break that assumption:

- **Inventory purchase orders** with international suppliers need an FX rate table and conversion at PO receipt.
- **Trainer commissions** already carry their own `currency` column (copied from the package at enrollment), which may differ from the organization currency if packages are priced in another currency.

A platform-wide currency strategy (single-currency-per-org vs multi-currency) is **out of scope for Phase 3** but should be *decided* so Phase 3 does not hard-code single-currency assumptions deeper. **Not in scope for P3-05.**

### 14.3 CRM conversion → membership plan assignment

The backlog expects “Trial memberships created” on conversion. If no trial plan exists in `membership_plans`, the conversion handler fails. Two options: (a) a “Trial” plan is created during CRM setup, or (b) the conversion API accepts an explicit `membership_plan_id`. **Tied to §15 Q22.** Either way, the failure mode must be a clear validation error, not a 500.

### 14.4 Tax calculation accuracy (compliance risk)

The backlog names “Tax calculation errors, compliance issues” directly. The riskiest part is the **configurable discount-before/after-tax order** (§4). Mitigations: centralise the arithmetic next to `toMoney()`/`sumMoney()`; unit-test combined tax + discount + exemption scenarios; and record the *applied* rate on `FINANCE_TAX_LINES` so historical invoices remain explainable after a rate changes. Also note that the existing `CreateInvoiceDto` already accepts `tax_code`, so **regression-test that invoices created without `tax_code` still produce `tax_amount = 0.00`** — Phase 1 behaviour must not change for existing callers.

### 14.5 Documentation drift (verified, with concrete instances)

This plan was written against source, and doing so **found real discrepancies between the planning docs and the code**:

| Claim in the docs | Reality (verified 2026-09-17) |
|-------------------|-------------------------------|
| Backlog P3-02: `refunds table (completed in P1-04)` | **No `Refund` entity exists.** `src/finance/entities/` contains only `Invoice`, `InvoiceItem`, `Payment`, `InvoiceNumberCounter`. `invoices.service.ts` explicitly says refunds are “out of scope”. |
| Backlog P3-02: `credit_notes table (completed in P1-04)` | **No `CreditNote` entity exists.** |
| Backlog P3-04: `tax_lines table (completed in P1-04)` | **No `TaxLine` entity exists.** |
| Backlog P3-04: `membership_discounts table (completed in P1-03)` | **No `MembershipDiscount` entity exists** (§4). |
| Backlog lists P3-01…P3-07 as a clean sequence | P3-03/P3-04 are physically placed **after** P3-07; **recurring billing and dunning have no backlog entry at all**. |
| Backlog P3-03: “Potentially add webhook logs table” | No such table in the ERD — it must be designed (§3). |

**Impact**: any estimate derived from the backlog's “completed in P1” annotations will be **materially too low**, because those tables are not started. **Recommendation**: correct the backlog (§12.3) before sizing Phase 3.

### 14.6 Loyalty redemption — optional scope (§15 Q18)

Phase 2 deferred loyalty redemption to “whenever finance integration exists”, and Phase 3 *is* that integration. But `LoyaltyReward` remains schema-only with “no redemption workflow”, and no Phase 3 backlog item covers it. **This is the first candidate to cut** if Phase 3 overruns: `LoyaltyTransaction` already carries the `redeem` transaction type, so deferring costs nothing structurally.

### 14.7 Worker infrastructure scaling

Phase 3 could add **five** new workers (Dunning, Recurring Billing, CRM Nurturing, CRM Follow-ups, CRM SLA Monitor) on top of the three existing (Outbox, Membership Expiry, Payment Retry). `BackgroundWorker` uses `SchedulerRegistry` + `setInterval` with a “no overlapping ticks” guard. Concerns:

- **No distributed locking.** Multiple application instances each tick every worker. The existing design mitigates this with *row locks inside each batch* (`expireDueMemberships`) and the outbox lease (`OUTBOX_LOCK_DURATION_MS`) — sufficient for idempotent scans, but **any new worker that is not idempotent must add its own guard.** This should be an explicit per-worker checklist item.
- **No queue, no retry semantics, no DLQ** for new workers. The outbox is the only durable work queue (with `AddDeadLetteredToOutbox` already migrated), so **publishing events and letting the outbox poller drive reactive work is preferable to in-worker retry loops.**
- **Operational load**: eight interval timers across instances. Consider whether a queue system (Bull/BullMQ) should arrive in Phase 3 or wait for Phase 5 (Notifications). **Recommendation: defer the queue, but require every new worker to be idempotent and OFF by default.**

### 14.8 Tenant-isolation defects in the ERD (security risk)

The single most consequential finding in this plan: **several ERD tables for Phase 3 have no `organization_id`**, and in two cases that is a cross-tenant data leak rather than a mere inconvenience:

| Table | Missing | Severity |
|-------|---------|----------|
| `INVENTORY_SUPPLIERS` | `organization_id` | **Critical** — supplier directories (names, contacts, phones, emails) would be shared across all tenants. |
| `INVENTORY_INVENTORY_TRANSACTIONS`, `INVENTORY_INVENTORY_LOTS` | `organization_id` | High — requires a join to establish tenancy. |
| `FINANCE_FINANCIAL_LEDGER`, `FINANCE_TAX_LINES`, `FINANCE_REFUNDS`, `FINANCE_CREDIT_NOTES` | `organization_id` | High — the ledger is the most sensitive table in the system. |
| `CRM_LEAD_ACTIVITIES`, `CRM_FOLLOW_UPS`, `CRM_CONVERSIONS` | `organization_id` | High — lead PII (names, phones, emails) would require a join to scope. |
| `CRM_LEAD_SOURCES`, `CRM_LEAD_STAGES` | `organization_id` (possibly intentional) | Medium — acceptable **only** as deliberate global reference tables. |

Phase 1 already set the precedent for adding this column as a documented deviation (`InvoiceItem`, `TrainerCommission`). Phase 3 must apply the same treatment **at migration time** — adding tenancy columns to a populated table later is far more expensive. This should be treated as a **blocking pre-migration review item**, not a nice-to-have.

---

## 15. Open Questions (23 items)

> **Count change**: an earlier draft of this plan collected **16** questions. Verifying the plan against source raised the count to **23**, because five issues were found that the docs did not reveal: the missing `membership_discounts` entity (§4/§14.5), the absent payout schema and `paid` status (§6), the missing `pt.events.ts` contract (§6), the inventory purchase-order/costing gaps (§7), and the ERD tenant-isolation defects (§14.8). Nothing was silently added — each question below traces to a specific finding.
>
> That pass also produced **five weaker findings** recorded as flagged omissions/tensions rather than questions (O1–O5), joined by **one gap already noted inline in §9's API table (O6)** — see §15.1. They are deliberately left unresolved: none blocks a build decision, and forcing an answer now would manufacture precision the evidence does not support.

Each question states its options, a recommended default where one exists, and the sections that depend on it.

### A. Finance — Ledger & Refunds

**Q1 — Ledger materialization strategy.** Should the ledger read model be (a) materialized views refreshed on a schedule, (b) a denormalized table maintained by event handlers, or (c) plain views with no caching?
*Recommendation*: (a) for reporting views + (c) for the per-member balance. Option (b) creates the second source of truth Phase 1 deliberately avoided. Also confirm the ledger's **`organization_id` and `currency` columns** — the ERD has neither. **Blocks §1.**

**Q2 — Financial period locking.** Do we need period close/lock (no backdated entries into a closed month)? No entity in the codebase has a period field today.
*Impact*: if yes, it must be designed into P3-01 rather than retrofitted onto a live ledger. **See §14.1.**

**Q3 — Separate reporting permission?** Is reporting `finance:read` (reuse) or a new `finance:report` action? Same question for `crm:report` on `GET /v1/sla/reports`.
*Recommendation*: add the distinct actions — the codebase already separates finance write actions (`finance:record-payment`), so separating reporting reads is consistent. **Affects §1, §9.**

**Q4 — Is line-level payment allocation in scope?** `FINANCE_PAYMENT_ALLOCATIONS` can allocate a payment to specific invoice items. Is that required in Phase 3, or is invoice-level payment enough?
*Impact*: if out of scope, the table can be deferred entirely — it is not needed for refunds or credit notes. **Affects §2.**
**Decision** (P3-02, 2026-09-19): **Out of scope — deferred entirely.** `FINANCE_PAYMENT_ALLOCATIONS` / `PaymentAllocation` is not built, in P3-02 or elsewhere in Phase 3. Refunds and credit notes are payment- and invoice-level, never line-level, so nothing in §2 requires it. If line-level reporting is wanted later it is an additive change (a new table plus a narrower lookup), the same reasoning Q6 applies to a hypothetical `branch_id`.

**Q5 — Refund and credit-note lifecycle.** Three linked decisions:
  - **Fully-credited invoices**: Model A (adjustments are separate records; `Invoice.status` untouched — recommended) or Model B (new `credited`/`refunded` states, requiring changes to `VALID_INVOICE_TRANSITIONS` and Phase 1 tests)?
  - **Partial refunds**: may a payment be refunded multiple times up to its total? Any min/max?
  - **Gateway responsibility**: must the provider refund succeed before the refund row is written (synchronous), or is the row written `pending` and processed asynchronously?
**Affects §2, §3, §6.**
**Decision** (P3-02, 2026-09-19):
  - **Fully-credited invoices — Model A.** Adjustments are separate records; `Invoice.status` is never rewritten, so `VALID_INVOICE_TRANSITIONS` and `voidInvoice()`'s paid guard are unchanged and Phase 1 behaviour (and its tests) is preserved. A credit note reduces the *derived* outstanding balance, consistent with the existing derived-balance pattern.
  - **One expression owns the derived balance — `InvoicesService.outstanding(total, paid, credited)`.** Model A leaves `status` alone, so the derived balance *is* the answer to "what does this invoice still owe", and three callers need that answer: the `outstanding_amount` the API reports (list and detail), the ceiling `PaymentsService` enforces when refusing an over-payment, and the test `PaymentsService` applies when deciding whether the invoice has become `paid`. All three call the one `public static` method instead of subtracting in place, because the ceiling and the advertised balance are the same question asked twice — derived separately they can drift, and a payment would then be refused against a balance the API was simultaneously advertising as payable. `creditNoteTotalsByInvoice` supplies the `credited` term; `outstanding()` stays the only place the subtraction happens. `credited` is a **required** argument with no `'0.00'` default, so no caller can silently inherit a payments-only balance by forgetting to pass one — which is exactly how the Model A gap would reappear. The result is floored at zero, so "is anything still owed?" is asked as `outstanding() <= 0` rather than by comparing an amount sum against the invoice total. The P3-02 ledger views apply the same rule in SQL (`SQL_ISSUED_CREDIT_NOTE` — issued credit notes only), so the API and the ledger cannot report different balances for the same invoice.
  - **Partial refunds — allowed.** A payment may be refunded repeatedly up to its total (`SUM(refunds.amount) ≤ payment.amount`), with no additional cap and no minimum. Enforced inside the transaction, not by a pre-check.
  - **Gateway responsibility — not gateway-executed in P3-02.** Refunds are staff-initiated and recorded manually, written directly as `succeeded` with no provider call; the `pending` state exists in the schema for P3-03 to use. P3-03 later adds a gateway-initiated path **as an addition, not a redesign**.
  - **Tax reversal — the credit note carries its own breakdown; `FINANCE_TAX_LINES` is never touched.** `CreditNote` stores its own `net_amount` / `tax_amount` / `gross_amount`, computed at creation time. It does **not** write to or modify `FINANCE_TAX_LINES`, which stays an immutable audit record of the tax applied to each invoice line — the reversal is a separate adjustment record under Model A, not an edit to the original. For a **partial** credit the split is proportional to the invoice's own already-applied rate (`invoice.tax_amount / invoice.total_amount`), **not** a fresh `FINANCE_TAX_RATES` lookup, so the reversal reflects what was actually charged and stays correct even if the rate is later changed, expired or deleted. Rounding is applied once to the tax part with the net derived from it, so `net + tax = gross` exactly (the same discipline as `computeLineTax`). The arithmetic lives in exactly one place, `CreditNotesService.splitCredit`.
    **Consequence to be aware of:** because the ratio is invoice-wide, a partial credit reverses tax at the invoice's *blended* rate, not per line. Crediting in full is exact and reproduces the invoice's stored `subtotal` and `tax_amount`; a partial credit is exact in aggregate but not attributable to any single line. Line-level credit attribution would need line targeting on the request — and line-level allocation, which Q4 rules out — so it is a scope change rather than a refinement. **This is a tracked limitation, not a caveat to be rediscovered:** per-line credit tax would need `PaymentAllocation` (`FINANCE_PAYMENT_ALLOCATIONS`), which **Q4 deferred entirely**, so a future request for it reopens Q4 rather than extending `splitCredit`. Nothing in the schema can attribute a credit to a line today, and this document is the only place that says so.
  - **Which invoices can be credited.** `void` is rejected: it owes nothing, so there is nothing to credit. `draft` **is** creditable, because a draft does still owe (it is in `OUTSTANDING_INVOICE_STATUSES`); §2 does not restrict it, although in practice a draft is more likely to be edited or voided. `paid` is creditable too — that is the point of Model A, and of §2's note that `voidInvoice()` directs paid invoices to a credit note.

    **Recorded honestly: `draft` crediting was not a considered decision.** It is a by-product of writing the guard as "reject `void`" against `OUTSTANDING_INVOICE_STATUSES`, which happens to include `draft` — not the outcome of weighing whether a draft *should* be creditable. No requirement asked for either answer, so leaving it permissive is the conservative default rather than a ruling: crediting a draft is harmless (a draft can equally be edited or voided, and Model A never rewrites `status`, so the credit is visible only in the derived balance). A reviewer who wants drafts excluded should treat this as an **open question**, not a settled behaviour — it is recorded here so that it is a known consequence of the guard's shape instead of a surprise later.
  - **Consequence for §12.1:** §3's *"Blocks §2 if refunds are gateway-executed"* does **not** bind, because §2's refunds are manual. The build order stands as written — P3-02 (#3) before P3-03 (#4).

### B. Finance — Tax & Discounts

**Q6 — Tax rate granularity.** Per organization (one regime), per branch (different cities), or per invoice item (product-level taxability)?
*Impact*: determines whether `FINANCE_TAX_RATES` needs `branch_id` and/or item-category scoping. **Affects §4, §7.**
**Decision** (P3-04, recorded 2026-09-19): **Per organization** — one tax regime per tenant. `FINANCE_TAX_RATES` carries no `branch_id` and no item-category scoping. Adding either later is additive (a nullable column plus a narrower lookup), whereas removing one after invoices were written under it would not be. Built as `FINANCE_TAX_RATES` by migration `1788965263255`.

**Q7 — Tax-exempt handling.** No entity has a tax-exempt flag today. Attach it to the member (`tax_exempt` + reason), the organization, or the line item (zero-rated category)? The backlog requires “Tax-exempt members handled”, which points at the member.
**Affects §4.**
**Decision** (P3-04, recorded 2026-09-19): **Attached to the member** — `MEMBERS_MEMBERS.tax_exempt` (boolean, `NOT NULL DEFAULT false`) plus `tax_exempt_reason` (varchar(255), nullable), added by migration `1788965263256`. An exempt member is charged no tax on any line, but a **zero-rated `FINANCE_TAX_LINES` row is still written** per taxed line, because a zero-rated line is a real audit row rather than a missing one. The reason is required at the API boundary (`UpdateMemberDto`) and deliberately nullable in the schema, so no placeholder text is invented for rows that predate the column.

**Q8 — Membership discount ownership and scope.** Is first-class discounting in scope for Phase 3? If yes, `MEMBERSHIP_MEMBERSHIP_DISCOUNTS` must be **built from scratch** (it does not exist despite the backlog), and a decision is needed on whether Membership owns the definition while Finance applies it (recommended) or Finance owns both.
*Impact*: materially changes P3-04's size. **Affects §4, §13, §14.5.**
**Decision** (P3-04, recorded 2026-09-19): **First-class discounting stays in Phase 3 scope, but was split out of P3-04 into P3-04b.** P3-04 was built **tax-only**; `MEMBERSHIP_MEMBERSHIP_DISCOUNTS` is still absent from the codebase and is P3-04b's deliverable (see `docs/task-backlog.md` P3-04 / P3-04b). **Still open:** the ownership direction — Membership owning the definition while Finance applies it (§4's recommended default; §13 records the dependency as *"direction TBD"*) — is **not** yet ruled and should be settled as part of P3-04b, not assumed.

**Q9 — Tax/discount representation and calculation order.** Confirm that (a) discounts apply before or after tax **as configured**, (b) `subtotal` means net-of-tax so the existing `subtotal`/`tax_amount`/`total_amount` triple is populated consistently, and (c) whether per-line tax amounts require an `InvoiceCreated.v2` contract.
*Impact*: the calculation function signature and the `V2` decision both affect schema/contracts. **Affects §4, §14.4.**
**Decision** (P3-04, recorded 2026-09-19):
  - **(a) Discount ordering — deferred**, with discounts, to P3-04b. P3-04 computes tax on the line amount as given, so a future discount reduces the line total before tax is computed and no tax arithmetic has to change.
  - **(b) `subtotal` means net of tax — confirmed and implemented.** `subtotal` is net, `tax_amount` is the sum of the **per-line** tax values (never recomputed from the summed subtotal), and `total_amount = subtotal + tax_amount`, for both exclusive and inclusive regimes. This is what makes `Invoice.tax_amount` reconcile with the `FINANCE_TAX_LINES` rows to the cent.
  - **(c) No `InvoiceCreated.v2` — the contract is unchanged.** Per-line tax amounts are deliberately **not** added to the event payload; they are recorded in `FINANCE_TAX_LINES` and returned on the invoice read API (`tax_lines`). `InvoiceCreated.v1` stays byte-identical for callers that pass no `tax_code`.

### C. Finance — Gateway, Recurring Billing & Dunning

**Q10 — Saved payment method storage.** Recurring auto-charge needs a stored payment method. Where does it live (`Member`? a new `PaymentMethod` table?), and what are the security constraints on storing provider tokens? `docs/security-plan.md` is the reference.
*Impact*: required for renewal option (c) and any auto-dunning. **Affects §3, §5.**

**Q11 — Gateway provider selection.** Which provider (Stripe, Paymob, …)? This determines the adapter name, the webhook signature scheme, and the `Payment.gateway_*` column set.
*Note*: the `PaymentGatewayPort` seam means this is a **binding** decision, not an architectural one. **Affects §3.**

**Q12 — Webhook processing model.** Process the gateway webhook inline within the request (simple; must be fast and idempotent) or persist it and process via a worker/queue? The backlog says “Webhook processing worker (if using queue)”.
*Recommendation*: persist-then-process, because it makes the receipt→state-change step retryable. **Affects §3, §14.7.**

**Q13 — Renewal trigger point.** (a) Bill N days before expiry, (b) renew on expiry by extending `expireDueMemberships()` (recommended — reuses the existing row lock and exactly-once guarantee), or (c) hybrid with auto-charge.
Also: **module dependency direction** — `MembershipsModule → FinanceModule` risks a second `forwardRef` cycle (§13); event-driven coupling is preferred. **Affects §5, §13.**

**Q14 — Dunning policy ownership.** (a) Which component owns the **max-attempts counter** — the existing `PAYMENT_RETRY` worker or the new dunning worker (two counters must not disagree)? (b) Is the schedule exponential (`paymentRetryDelayMs`, existing) or fixed `[1, 3, 7]` days (backlog)? (c) Notification channels — internal alert, email, or both? (d) Are staff-facing controls (pause dunning, force escalate) in scope? (e) Does dunning need its own table?
**Affects §5, §3, §14.7.**

### D. Commission Payout & Clawback

**Q15 — Payout schema approach.** `TrainerCommission` has **no `paid` status** and **no `paid_at`/`paid_amount`** (Phase 2 excluded them by instruction). Choose: (a) a separate payout-run table pair (`PT_COMMISSION_PAYOUT_RUNS` / `PT_COMMISSION_PAYOUT_ITEMS` — recommended, it preserves the Phase 2 invariant and models a bulk run), or (b) add `payout_run_id` + `paid_at` + `paid_amount` to `TrainerCommission` (one migration, contradicts the Phase 2 exclusion).
Also: add a **`paid`** value to `TRAINER_COMMISSION_STATUS_VALUES`? And is a new **`pt:payout`** permission acceptable?
**Affects §6.**

**Q16 — Clawback granularity.** `TrainerCommission` is **one row per enrollment** (unique index on `pt_enrollment_id`), so a partial clawback cannot be a second row. Is clawback all-or-nothing (full reversal), or should a cancelled-after-N-sessions enrollment keep a pro-rata share? If pro-rata, `amount` must be adjusted or an adjustment line added.
**Affects §6.**

**Q17 — PT event contracts.** Should `packages/contracts/src/events/pt.events.ts` be created (recommended — matching `finance.events.ts` / `membership.events.ts`), given that `TrainerCommissionEarned.v1` is currently **backend-only** and absent from `docs/event-contracts.md`? Also resolve the naming inconsistency: PT event names are versioned (`'TrainerCommissionEarned.v1'`) while finance names are not (`'InvoiceCreated'` + a separate `FINANCE_EVENT_VERSION`).
**Affects §6.**

**Q18 — Loyalty redemption in Phase 3?** Phase 2 deferred redemption to “whenever finance integration exists”, and Phase 3 is that integration. `LoyaltyTransaction` already carries the `redeem` type, but `LoyaltyReward` has no workflow and no Phase 3 backlog item. Include it, or defer again?
*Recommendation*: defer — it is the cleanest scope cut (§14.6). **Affects §6, §13.**

### E. Inventory

**Q19 — Inventory costing method.** (a) FIFO — requires adding `unit_cost` to `INVENTORY_INVENTORY_LOTS`; (b) weighted average — workable with the current columns; (c) specific identification — requires a serial/lot identifier on every transaction.
*Impact*: **changes the schema**, so it must be answered **before** the migration is written. **Blocks §7.**

**Q20 — Stock level: derived or denormalised?** Derive from `INVENTORY_INVENTORY_TRANSACTIONS` (consistent with the Phase 1 “never denormalise a derived balance” principle, with a materialized view for lists — recommended), or add a `quantity_on_hand` counter to the item?
**Affects §7.**

**Q21 — Branch-level stock scoping.** `INVENTORY_INVENTORY_ITEMS` has no `branch_id`, so all branches of an organization share one stock pool. Acceptable, or is per-branch stock required? If required, `branch_id` must be added to items *and* transactions.
**Affects §7.**

### F. CRM

**Q22 — Member auto-creation on lead conversion.** (a) Create the member immediately via `MembersService.create()` using lead data, (b) create a prospect record staff promote later, or (c) create the member but leave plan assignment to a separate step?
Also: where does the **trial membership plan** come from (§14.3) — a seeded “Trial” plan, or a `membership_plan_id` parameter on the convert endpoint?
**Affects §8, §13, §14.3.**

**Q23 — Lead de-duplication.** How are duplicate leads prevented (same phone/email entered twice)? Options: a unique index on (`organization_id`, `email`) and/or (`organization_id`, `phone`), plus a manual merge endpoint. Note that the ERD defines no unique constraint on `CRM_LEADS`, and conversion idempotency depends on this.
**Affects §8, §14.3.**

### 15.1 Flagged omissions and tensions (not questions)

These six are **not** open questions — none blocks a build decision, and resolving them now would force precision the evidence does not support. They are recorded so a reviewer can act on them deliberately rather than rediscover them. O1–O5 were surfaced by a further review pass; **O6** was already noted inline in §9's API table (the “SLA policy CRUD” row), which pointed here without naming a target.

| # | Finding | Type | Evidence (literal) |
|---|---------|------|--------------------|
| **O1** | **§7 has no `Event contracts`, `API surface`, or `RBAC permissions` subsections.** Every other domain section (§1–§6, §8, §9) has all three; §7 stops after *Costing method*. §11 line 839 nonetheless asserts `inventory:*` resource tokens were “added”, and `docs/api-plan.md` lines 137–143 define seven inventory endpoints that §7 never maps to permissions. | Structural omission | §7 subsections: `Domain context`, `Four schema problems…`, `Stock level: derived or denormalised?`, `Costing method`. §11: “`inventory:*`, `crm:*` resource tokens added”. |
| **O2** | **`FinancialLedgerUpdated` is named but never adopted or dropped.** §1 says the read model publishes no events, while §2 quotes domain-map line 96 listing `FinancialLedgerUpdated` among reserved finance events. Whether that name is used, or deliberately abandoned because a derived read model has nothing to publish, is unstated. | Dangling name (tension) | §1: “**None.** Read models publish no events.” §2: “already reserved in `docs/domain-map.md` (line 96: `…, RefundIssued, CreditNoteIssued, FinancialLedgerUpdated`)” |
| **O3** | **§1 omits `GET /v1/financial-ledger`.** Both `docs/api-plan.md` line 76 and `docs/task-backlog.md` line 1594 define it, and §1 is *titled* “Financial Ledger Read Model”, yet its API table lists only three endpoints — none of them this one. There is also no `FINANCE_FINANCIAL_LEDGER` table to serve it. | Omission | api-plan: “`GET /v1/financial-ledger` - List financial ledger entries (paginated)”. §1 table rows: outstanding-balance, revenue-summary, outstanding-by-status. |
| **O4** | **§6 uses `/v1/pt/…` route prefixes that appear nowhere in `docs/api-plan.md`.** PT routes there use flat prefixes (`/v1/pt-packages`, `/v1/pt-sessions`), and `src/pt/` contains no `controllers/` directory at all — so every PT route is net-new and the prefix is an unmade decision, not an inherited convention. | Convention inconsistency | §6: “`POST /v1/pt/enrollments/{id}/cancel`”, “`GET /v1/pt/commissions`”. api-plan: “`GET /v1/pt-packages`”. `src/pt/` = `dto entities pt.constants.ts pt.module.spec.ts pt.module.ts services`. |
| **O5** | **§3's webhook guard claim is inaccurate.** It says the endpoint “must be exempt from the standard `@RequirePermissions` guard path”. `PermissionsGuard` already returns `true` when a route carries no permission metadata, so only the JWT guard needs `@Public()`. Harmless in effect, but it misdescribes the auth mechanism to a security reviewer. | Inaccuracy | §3: “Must be exempt from the standard `@RequirePermissions` guard path”. `permissions.guard.ts`: “`if (!required \|\| required.length === 0) return true;`” |
| **O6** | **SLA policy management has no defined endpoint.** `CRM_SLA_POLICIES` is planned as a net-new table, but no API is specified to configure it, so policies could only be seeded. P3-07's backlog entry lists three endpoints, none of them a policy CRUD. | Scope gap (unspecified endpoint) | §9's API table reads “`CRM_SLA_POLICIES` is a planned net-new table … but no endpoint is specified to manage it”, with the Permission column `—`. §9's domain context: “**Neither `CRM_SLA_POLICIES` nor `CRM_SLA_BREACHES` exists in the ERD** … so both are **net-new tables**”. P3-07's backlog entry lists exactly three endpoints under “API changes” — `GET /v1/follow-ups/due`, `POST /v1/follow-ups/{id}/complete`, `GET /v1/sla/reports` — none a policy CRUD; its “Database changes” says “Create sla_policies table” (backlog snake_case, mapped by §9's naming note). No CRM migration exists in `src/migrations/`. |

**O1 correction — added later, and it applies to O1's evidence only.** The “§11 line 839” citation is wrong twice over. First, the sentence is at **line 843** (the row beginning “RBAC via `@RequirePermissions({ resource, action })`”); line 839 is the unrelated “State value sets live in a domain constants file” row, which mentions the *planned* `crm.constants.ts` — the likely source of the slip. Second, and more substantively, that sentence sits in §11's **“Phase 3 application”** column, so “`inventory:*`, `crm:*` resource tokens added” is forward-looking: it lists work Phase 3 will do, not a claim that the tokens exist. A `grep -rni 'crm|inventory' src` returns **zero** hits, and neither `src/crm/` nor `src/inventory/` exists — which is precisely what a forward-looking statement predicts, so the grep does **not** contradict §11. O1's finding still stands on its other evidence (§7's missing subsections; api-plan's seven endpoints with no permission mapping), but this citation should be struck or reworded rather than counted as supporting it.

---

*End of Phase 3 Scoping Plan — DRAFT*
*Next step: resolve the open questions in §15, correct the documentation drift in §14.5 / §12.3, then review and approve. Implementation should begin with **P3-01 Financial Ledger** (§1 / Wave 1).*
*No git staging or committing until explicit approval. Per the session safeguards in `.clinerules`, no staging, commit, or history-changing command will be run without an explicit, in-session confirmation naming the files.*
