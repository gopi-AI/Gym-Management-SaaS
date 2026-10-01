# Phase 3 Completion Plan

> **Status: COMPLETE pending commit/push; hardening track (DEF-02..08, D16) open**

**Purpose:** the task list required before "Phase 3 is complete" can be asserted.
**Split:** Workstream 0 items are decisions an owner/architect must make — a coding agent
must not invent them (`.clinerules`: REPOSITORY IS LAW). Workstreams 1–8 are the
agent-executable task layer, subject to the Workstream 0 rulings they depend on.

**Verified baselines.** The task layer was written against `a5a32f77` (2026-09-30) and the
sign-off re-run was executed against `89cefcd3` (2026-10-01). All 20 commit hashes asserted
in this document were re-verified against `git log` on 2026-10-01.

**Document structure.** This revision separates three layers that were previously
interleaved — the rulings, the task layer, and the evidence:

| Section | Layer | What it holds |
|---|---|---|
| [Workstream 0](#workstream-0--rulings-register) | Rulings | The decision layer; each row's authority is a `Decision` line in `docs/phase3-scoping-plan.md` §15 / §15.2, enumerated by the register below |
| [Task layer at a glance](#task-layer-at-a-glance) + [Workstreams 1–8](#workstream-1--p3-10-storage-configuration) | Execution | The agent's work surface — one table, one status vocabulary |
| [Appendix A](#appendix-a--evidence-ledger) | Evidence | Raw verification records (mutation matrices, gate runs, sweeps) — records, not work items |
| [Appendix B](#appendix-b--findings) | Findings | Out-of-scope findings and the 2026-09-30 sign-off observations |

**Status vocabulary** — the only statuses used in the task layer below:

| Status | Meaning |
|---|---|
| `DONE` | Complete; a commit or run is cited as evidence |
| `PARKED` | Deliberately deferred behind a named trigger. Not actionable now, and not a defect |
| `DESCOPED` | Ruled out of Phase 3 by an owner decision |
| `N/A` | Moot — superseded by another item's resolution |
| `STANDING` | A constraint binding future work, not an outstanding work item |

---

## Task layer at a glance

Nothing here is `OPEN`. Every row's detail, acceptance criterion and closure note is in its
workstream section; every evidence block is in [Appendix A](#appendix-a--evidence-ledger).

**One ID was assigned by this revision.** The 2026-10-01 follow-up on the discount
integration spec was previously unnamed; it is numbered **T4.5** here so the task layer has a
stable handle for it. No other ID was added, removed or renumbered — `T1.1`–`T8.5`,
`D1`–`D17`, `OI-1` and `OI-2` are unchanged, and the duplicate `T8.5` heading is merged into
one item.

| ID | Status | Task | Gated on | Evidence |
|---|---|---|---|---|
| T1.1 | `DONE` | `@Global()` on `S3Module` (not a `SharedModule`) | — | `b71decf3` |
| T1.2 | `PARKED` | `buildCrmAttachmentKey()` / `buildInventoryImageKey()` | a CRM/inventory S3 consumer existing | — |
| T1.3 | `DONE` | `.env.example`: `S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET`, `AWS_REGION` | — | `387f706c` |
| T1.4 | `DONE` | `S3Service` reads `process.env`, not `ConfigService` — ratified | — | §15.2 T1.4 |
| T1.5 | `N/A` | `SharedModule` re-export | moot with T1.1 | — |
| T1.6 | `STANDING` | S3 upload-first / DB-insert-second ordering for any future consumer | a new consumer landing | `s3.service.ts:8-14` |
| T1.7 | `N/A` | Specs for the new key builders | moot with T1.2 | — |
| T1.8 | `DONE` | `uploads/` in `.gitignore` | — | `a38bead9` |
| T2.1 | `DONE` | `GET /v1/inventory/items/{id}` | — | Batch 8b |
| T2.2 | `DONE` | `PATCH /v1/inventory/items/{id}` | — | Batch 8b |
| T2.3 | `DONE` | `GET /v1/inventory/lots` (paginated, filterable) | — | Batch 8b |
| T2.4 | `DONE` | `GET /v1/inventory/purchase-orders/{id}` | — | Batch 8b |
| T2.5 | `DONE` | Keep `POST transactions/consume`; do not add `POST transactions` — ruled | — | `docs/api-plan.md:151` |
| T2.6 | `PARKED` | Lot-expiry worker | D13 | — |
| T2.7 | `PARKED` | Inventory reorder worker + `CRM_NURTURING` | D13 | — |
| T2.8 | `DONE` | Record D7 in §15 | — | §15 Q19, Q20, Q21 |
| T3.1 | `N/A` | Operator renewal route | D4 ruled worker-only | §15 Q13 |
| T3.2 | `N/A` | Renewal route wiring | moot with T3.1 | — |
| T3.3 | `DONE` | Record the worker-only ruling | — | §15 Q13 |
| T4.1 | `DONE` | `membership-discount.entity.spec.ts` | — | `fa4acee5` |
| T4.2 | `DONE` | Deterministic tie-break on the three discount reads | — | `4d4aac0a` |
| T4.3 | `DONE` | `id ASC` direction ratified as the final tie-break — owner ruling, confirmed 2026-10-02 | — | §15.2 T4.3 |
| T4.4 | `DONE` | No `MembershipDiscountApplied` event — owner ruling, confirmed 2026-10-02 | — | §15.2 T4.4 |
| T4.5 | `DONE` | Renewal-level integration test through the real service read | — | `memberships-discount-renewal.integration.spec.ts` |
| T5.1 | `DONE` | `database-plan.md`: the 6 missing tables + the real payout pair | — | `3090573b`, `33a14f3a` |
| T5.2 | `DONE` | `.env.example`: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | — | `287faeec` |
| T5.3 | `DONE` | Backlog: P3-08/P3-09 entries, rejoined P3-02/P3-06, numeric order | — | `cb51f0ca`, `e241aaac`, `1608cb31` |
| T6.1–T6.5 | `DESCOPED` | The five `implementation-roadmap.md` §Phase 3 frontend deliverables | D12 | `implementation-roadmap.md:162`, `task-backlog.md:1552` |
| T7.1–T7.8 | `DONE` | Documentation reconciliation | — | `73f6aa36` |
| T8.1 | `DONE` | Backend gate: typecheck + lint + jest | — | `/tmp/p3gates/*` |
| T8.2 | `DONE` | Gated integration specs on a fresh migrated DB (run locally under D16) | — | 3 suites / 24 tests |
| T8.3 | `DONE` | Production Docker image build + boot probe | — | `/tmp/p3gates/docker_build.log` |
| T8.4 | `DONE` | Migration replay from zero (45/45) | — | `/tmp/p3gates/mig_replay.log` |
| T8.5 | `DONE` | Push, verified against a fresh `git ls-remote` | — | `415ecc1e`, `55b22082` |

**Not in the task layer:** the 2026-10-01 sign-off work is intentionally left **uncommitted**
by owner instruction — no commit or push is claimed for it (see [T8.5](#workstream-8--the-actual-sign-off-gate)).

---

## Workstream 0 — Rulings register

Every ruling is made. Each row's authority is a `Decision` line in
`docs/phase3-scoping-plan.md` §15 / §15.2, enumerated by the register below — which, not this
sentence, is the authority for how many there are. This register is a
pointer, not a substitute: read the `Decision` line for the ruling's full text.

| ID | Question | Ruling / outcome | Recorded at |
|---|---|---|---|
| **D1** | P3-10 S3 gap priority | In scope for **config only**; key builders deferred until a consumer exists | §15.2 D1 |
| **D2** | Discount ownership direction + tie-break | Membership owns the definition, Finance applies it and snapshots it; latest `starts_at` → latest `created_at` → `id` | §15 Q8 |
| **D3** | Gateway provider selection | **Stripe** behind the gateway interface; `STRIPE_*` optional at boot | §15 Q11 |
| **D4** | Renewal trigger / operator route | **Worker-triggered only**; no operator renewal route in Phase 3 | §15 Q13 |
| **D5** | Dunning counter owner; schedule | Ratified as shipped: one counter (`Payment.retry_count`), exponential schedule, daily cadence | §15 Q14 |
| **D6** | Clawback granularity | **All-or-nothing**, one row per enrollment; pro-rata deferred | §15 Q16 |
| **D7** | Inventory costing; per-branch stock | **FIFO**; per-branch stock intended; stock **derived**, no column | §15 Q19, Q20, Q21 |
| **D8** | Member auto-creation on conversion | **Option (a)** — `convert()` creates the member. Trial-plan source remains OPEN/DEFERRED | §15 Q22 |
| **D9** | Lead de-duplication | **Not implemented in Phase 3** — deferred | §15 Q23 |
| **D10** | Loyalty redemption in Phase 3 | **Out of Phase 3**; the `REDEEM` constant is reserved | §15 Q18 |
| **D11** | Recording-only tallies (Q1, Q2, Q3, Q12, Q15, Q17, Q20) | All ruled and recorded | §15 Q1–Q17 |
| **D12** | The five roadmap §Phase 3 frontend deliverables | **Descoped** — Phase 3 is API-only; unscheduled; no "Phase 3b" | §15.2 D12 |
| **D13** | P3-05 workers + `CRM_NURTURING` | **Deferred** — lot-expiry, inventory reorder and `CRM_NURTURING` workers | §15.2 D13 |
| **D14** | Security review (§15.2 item 4) | **PERFORMED 2026-10-01** → `docs/phase3-security-review.md` | §15.2 D14 |
| **D15** | API/integration gate (§15.2 item 5) | **DELIVERED 2026-10-01** → `scripts/api-gate.js` + `npm run api:gate`; browser E2E not required | §15.2 D15 |
| **D16** | ESLINT-002 / web SIGBUS / CI coverage | **Tracked as a separate hardening task**, not Phase 3 scope | §15.2 D16 |
| **D17** | P2-09 (Member 360 UI) | **Carried over, unscheduled**; route and endpoint strategy ruled | §15.2 D17 |
| **OI-1** | Inventory read branch-scoping | **RESOLVED — reads are branch-scoped** — owner ruling, confirmed 2026-10-02 | §15.2 OI-1 |
| **OI-2** | Purchase-orders list branch-scoping | **RESOLVED — branch-scoped** (OI-2a); suppliers stay organisation-scoped (OI-2b) — owner ruling, confirmed 2026-10-02 | §15.2 OI-2 |

**M7 accepted (Batch 8e, 2026-10-01).** The `listLots` join condition
`item.organization_id = lot.organization_id` (`inventory.service.ts:138`) is **defence in
depth**, not the tenancy boundary: `INVENTORY_LOTS` already carries its own
`organization_id`, so the direct predicate is what excludes another tenant. It is therefore
pinned by a **unit query-shape assertion only** (`inventory.service.spec.ts:94`); no
cross-org lot row asserts it. Accepted as-is.

**Corrections to the record.** `P3-13 … P3-17` **do not exist** — the checklist report claims
twice (`:551`, `:564`) that they were "filed 2026-09-29 as backlog P3-13 … P3-17"; the only
occurrences of those IDs anywhere in `docs/` are those two claims
(`grep -nE '^#{2,3} P3-1[3-7]' docs/task-backlog.md` → no match). The same claim is corrected
at its source by T7.6.

---

## Workstream 1 — P3-10 Storage configuration

Every one of plan §10's "Files to change" rows, as it stood at `a5a32f77` and after the
2026-10-01 config commits:

```
@Global() on S3Module:                    ABSENT -> DONE (b71decf3)
buildCrmAttachmentKey/InventoryImageKey:  ABSENT -> STILL ABSENT (key builders deferred)
S3/AWS/bucket vars in .env.example:       0      -> 3 (387f706c)
SharedModule:                             ABSENT -> NOT introduced; @Global() chosen (b71decf3)
```

- [x] **T1.1** `src/shared/storage/s3.module.ts` — add `@Global()`, or introduce a
  `SharedModule` re-exporting `S3Module` (plan §10 rec 2; plan notes `@Global()` is the
  smaller change). Pick one, don't do both. — **`DONE` 2026-10-01 in `b71decf3`**: `@Global()`
  chosen (the smaller change); `SharedModule` deliberately not introduced.
  `src/app.module.spec.ts` + `src/app.boot.spec.ts` (21 tests) compile and boot the real
  `AppModule` with it.
- **T1.2** — `PARKED` **2026-10-01 by D1** ("key builders are deferred until a consumer
  exists"): `buildCrmAttachmentKey()` / `buildInventoryImageKey()` are not built; no
  CRM-attachment or inventory-image consumer exists, so there is nothing for a key builder to
  serve. `src/shared/storage/s3.service.ts` keeps its `buildKey()` 4-argument signature
  untouched. **Trigger:** a CRM-attachment or inventory-image consumer landing.
- [x] **T1.3** `.env.example` — add `S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET`, `AWS_REGION`.
  Note the file already groups sections with `# ── … ──` banners; add a matching one. The
  service defaults are `./uploads`, `gym-documents`, `us-east-1` (`s3.service.ts:33,46,48`).
  — **`DONE` 2026-10-01 in `387f706c`**: added under a matching
  `── Object storage: member documents (S3) ──` banner, with the same three defaults and a
  note that the read is `process.env`, not `ConfigService`.
- [x] **T1.4** **RULED 2026-10-01 (owner): `process.env` ratified as shipped.** `S3Service`
  reads its three settings from `process.env`; `.env.example` says so explicitly in the
  object-storage section. Recorded in `docs/phase3-scoping-plan.md` §15.2 T1.4. No code
  change. — **`DONE`**
- **T1.5** — `N/A`: T1.1 chose `@Global()` (the smaller change), so no `SharedModule`
  re-export is needed and no module wiring changed.
- **T1.6** — `STANDING` constraint for any future S3 consumer: **S3-upload-first,
  DB-insert-second** with best-effort `delete()` on DB failure (plan §10 rec 4, documented at
  `s3.service.ts:8-14`). Guidance, not outstanding work — there is no new consumer in Phase 3.
- **T1.7** — `N/A`, moot with T1.2: no new builders, so no new builder specs. The existing
  `documents.service.spec.ts` remains the pattern to mirror when a consumer lands.
- [x] **T1.8** Consider `uploads/` in `.gitignore` — it was absent, so a local-dev upload
  surfaced as untracked noise. — **`DONE` 2026-10-01 in `a38bead9`**: `uploads/` added;
  `git check-ignore -v uploads/x` → `.gitignore:25:uploads/`.

**Acceptance:** `grep -q '@Global' src/shared/storage/s3.module.ts` (or `SharedModule`
exists); both builders exist and are unit-tested; `.env.example` has the three vars;
`npm run typecheck && npm run lint && npx jest --silent` green. — **Partially met
2026-10-01.** The config half holds: `grep -q '@Global' src/shared/storage/s3.module.ts`
passes (`b71decf3`), `.env.example` has the three vars (`387f706c`), `uploads/` is ignored
(`a38bead9`), and `npm run typecheck`, `npx eslint` and the module specs are green. The other
half does **not**: "both builders exist and are unit-tested" is false — the CRM/inventory key
builders are deferred (T1.2/T1.7 `PARKED`).

---

## Workstream 2 — P3-05 Inventory gaps

Backlog asks for 8 item endpoints; 4 were missing. Registered today: `GET/POST suppliers`,
`GET/POST items`, `GET/POST purchase-orders`, `POST purchase-orders/:id/receive`,
`GET stock`, `POST transactions/consume`.

- [x] **T2.1** `GET /v1/inventory/items/{id}` — org-scoped, `inventory:read` — **`DONE`
  (Batch 8b, 2026-10-01):** `inventory.controller.ts:14` → `InventoryService.getItem` — org
  predicate (`where: { id, organization_id }`), 404 on missing/cross-org. Unit + integration
  specs.
- [x] **T2.2** `PATCH /v1/inventory/items/{id}` — org-scoped, `inventory:update`; no entity
  spreading on update (`.clinerules` §3) — **`DONE` (Batch 8b, 2026-10-01):**
  `UpdateInventoryItemDto` whitelists `name`/`sku`/`barcode`/`unit`/`selling_price`/
  `is_active` only (`organization_id`/`branch_id`/`id`/`created_at` never writable; **no
  stock/quantity field** — stock moves only through transactions); the service assigns
  field-by-field, no spread; the row's own branch is cross-checked via `requireBranchAccess`.
  Unit + integration specs.
- [x] **T2.3** `GET /v1/inventory/lots` (paginated, filterable) — `inventory:read`; note
  `INVENTORY_INVENTORY_LOTS` lacks `organization_id`, so org-scoping requires the join
  through `inventory_items` (plan §7 problem 2) — **PREMISE CORRECTED 2026-10-01:** this note
  is stale. Migration `1788965263264` created `INVENTORY_LOTS` **with** its own
  `organization_id` (`src/inventory/entities/inventory-lot.entity.ts:7`), so org-scoping is a
  direct predicate and **no join through `inventory_items` is required**. Plan §7 "problem 2"
  described the pre-migration ERD. — **`DONE` (Batch 8b, 2026-10-01):** `listLots` scopes by
  that own column (direct predicate — **deviation from the batch instruction's proposed join,
  which is unnecessary here and was NOT used**); paginated `{ data, total, page, limit }`.
  Unit + integration specs.
- [x] **T2.4** `GET /v1/inventory/purchase-orders/{id}` — `inventory:read` — **`DONE`
  (Batch 8b, 2026-10-01):** `getPurchaseOrder` loads the order org-scoped, then reads its
  lines by `po_id` (the parent-scoped-children pattern reused from `receivePurchaseOrder`;
  `INVENTORY_PURCHASE_ORDER_ITEMS` has no `organization_id`); 404 on missing/cross-org. Unit
  + integration specs.
- [x] **T2.5** Decide `POST /v1/inventory/transactions` vs the shipped
  `POST transactions/consume` — either align or record the deviation — **`DONE`: DECIDED
  2026-10-01 (owner): keep the shipped `POST /v1/inventory/transactions/consume`; do NOT add
  `POST /v1/inventory/transactions`.** **Supporting analysis (not part of the ruling):** the
  shipped route is the FIFO-consumption write path
  (`src/inventory/controllers/inventory.controller.ts:22` → `InventoryService.consumeStock` →
  `consumeFifo`), org- and branch-scoped; the documented route is a generic "record inventory
  transaction" surface that no caller needs — `grep -rn 'inventory/transactions' src apps
  packages docs | grep -v '/consume'` → no reference found in `src/`, `apps/` or `packages/`;
  references found only in `docs/` (`docs/api-plan.md:141`, `docs/api-plan.md:147` — this
  note, `docs/task-backlog.md:545`). Deviation recorded under **Inventory** in
  `docs/api-plan.md` (cited by ID at `docs/api-plan.md:151`).
- **T2.6** — `PARKED` **2026-10-01 by D13** (lot-expiry worker).
- **T2.7** — `PARKED` **2026-10-01 by D13** (inventory reorder worker; also `CRM_NURTURING`).
  No inventory worker exists; `worker-config.ts` and `.env.example` are unchanged.
- [x] **T2.8** — **`DONE`**: D7 is recorded in `docs/phase3-scoping-plan.md` §15 (FIFO costing
  `:1124`, per-branch stock `:1132`, derived stock `:1128`).

**Acceptance per endpoint:** route registered, org predicate on every query, branch
cross-check where `branch_id` is accepted, controller + service specs, gates green. — **Met**
(Batch 8b evidence, [Appendix A](#batch-8b-evidence--2026-10-01)).

---

## Workstream 3 — P3-09 operator renewal surface

- **T3.1** — `N/A`: **not required — D4 ruled worker-only** (recorded in §15 Q13). No
  operator renewal route is added; a future one must reuse `renewOne` and the idempotency key
  `membership-renewal:{membershipId}:{renewalDate}` (`memberships.service.ts:423`).
- **T3.2** — `N/A`, moot with T3.1.
- [x] **T3.3** — **`DONE`**: the worker-only ruling is recorded as the §15 Q13 `Decision`
  in `docs/phase3-scoping-plan.md`.

---

## Workstream 4 — P3-04b residuals

- [x] **T4.1** `src/memberships/entities/membership-discount.entity.spec.ts` — no
  `src/memberships/entities/*.spec.ts` existed (`create-membership-discount.dto.spec.ts`
  does). — **`DONE` 2026-10-01 in `fa4acee5`**: `membership-discount.entity.spec.ts` — 11
  assertions read from TypeORM decorator metadata via `getMetadataArgsStorage()` (no DB): the
  table name, the exact column set and types, and the two non-unique indices. The
  migration-only PARTIAL unique index and CHECK constraints have no decorator metadata and
  are excluded.
- [x] **T4.2** Fix the tie-break (D2). Either add an explicit `order` to all three reads,
  **or** add a real overlap constraint (`EXCLUDE USING gist (membership_id WITH =,
  tstzrange(starts_at, COALESCE(ends_at,'infinity')) WITH &&)`) — note the latter needs
  `btree_gist`, needs `ends_at IS NULL` normalized, and needs a repair step only if
  overlapping rows exist (the sweep found **0 rows in every reachable DB**, so there is
  currently nothing to repair). — **`DONE` 2026-10-01 in `4d4aac0a`**: the explicit-`order`
  path was taken (`MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER` = `starts_at DESC, created_at DESC,
  id ASC`, shared by all three reads — `renewOne`, `create`, `addDiscount`); the
  `EXCLUDE USING gist` path was not.
- [x] **T4.3** **RULED 2026-10-01 (owner), confirmed 2026-10-02: `id ASC` ratified as the final tie-break.** A full key tie (identical
  `starts_at`, `created_at`) resolves deterministically to the lowest `id`; this is the
  shipped `MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER` and is pinned by mutation M4 in
  `memberships-discount-renewal.integration.spec.ts`. Recorded in
  `docs/phase3-scoping-plan.md` §15.2 T4.3. — **`DONE`**
- [x] **T4.4** **RULED 2026-10-01 (owner), confirmed 2026-10-02: no `MembershipDiscountApplied` event.**
  Deliberately absent — no consumer exists, and the invoice-level snapshot
  (`FINANCE_INVOICE_DISCOUNTS`) is the durable record. Recorded in
  `docs/phase3-scoping-plan.md` §15.2 T4.4. — **`DONE`**
- [x] **T4.5** *(2026-10-01)* **Closed** — the integration spec now drives the real service
  read rather than replicating it: `memberships-discount-renewal.integration.spec.ts` runs
  `renew()` → `renewOne()` → real SQL over overlapping in-force rows and asserts the renewal
  **fee**. One membership carries three rows with distinct amounts (decoy 3.00 → 97.00, loser
  5.00 → 95.00, winner 7.00 → 93.00), so the fee names the row the service read; a second
  carries two rows tied on `starts_at` AND `created_at` (13.00 on the lower id). The fee is
  asserted from the `MembershipRenewed.v1` outbox payload and the invoice total, and the
  applied row from the `FINANCE_INVOICE_DISCOUNTS` snapshot. Mutation matrix in
  [Appendix A](#t45-mutation-matrix--2026-10-01).

  **Residual, recorded not fixed:** `memberships.service.spec.ts` asserts the tie-break only
  as `expect(<call>.order).toEqual(MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER)` at `:333`
  (`renewOne`), `:545` (`addDiscount`) and `:782` (`create`) — a comparison against the same
  imported constant, and no literal order object exists anywhere in that file. All four
  mutations stayed green on the unit spec. **The unit spec pins only that `order` is passed;
  the integration spec is what pins the key's contents.** Deliberately left as-is.

---

## Workstream 5 — Documented §12.3 prerequisites

- [x] **T5.1** `docs/database-plan.md` — add the tables the Doc 2 row (`:419`) lists as
  missing: `FINANCE_WEBHOOK_EVENTS`, `FINANCE_PAYMENT_METHODS`, `FINANCE_DUNNING_ATTEMPTS`,
  `FINANCE_INVOICE_DISCOUNTS`, `CRM_SLA_POLICIES`, `CRM_SLA_BREACHES` (done in `3090573b`),
  plus the real payout pair `PT_COMMISSION_PAYOUT_RUNS` / `PT_COMMISSION_PAYOUT_ITEMS` (done
  in `33a14f3a`) — `PT_COMMISSION_PAYOUTS` was never a real table. — **`DONE`**
- [x] **T5.2** `.env.example` — add `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
  (status-report Q3) — done in `287faeec`. — **`DONE`**
- [x] **T5.3** `docs/task-backlog.md` — add the missing backlog items: recurring billing
  (P3-09) and dunning (P3-08) — done in `cb51f0ca`; rejoin the displaced P3-02 and P3-06
  bodies — done in `e241aaac`; fix the P3-03/P3-04/P3-04b ordering — done in `1608cb31`. —
  **`DONE`**

---

## Workstream 6 — Frontend

**D12 ruled these OUT of scope (2026-10-01): Phase 3 is API-only and the five deliverables
are unscheduled.** The descope is recorded in `docs/implementation-roadmap.md:162` and
`docs/task-backlog.md:1552`; no "Phase 3b" exists and none of the five is filed as a backlog
entry.

- **T6.1** Inventory management UI — `DESCOPED` (D12)
- **T6.2** CRM pipeline + lead management — `DESCOPED` (D12)
- **T6.3** Advanced financial reports — `DESCOPED` (D12)
- **T6.4** Trainer commission statements — `DESCOPED` (D12)
- **T6.5** Refund/credit-note processing UI — `DESCOPED` (D12)

Should any be rescheduled, each must follow the existing web conventions: App Router under
`apps/web/src/app/`, React Query via **dedicated custom hooks only** (no fetching inside
components), API modules mirroring `apps/web/src/lib/*-api.ts`, and a backlog entry created
first.

---

## Workstream 7 — Documentation reconciliation

All eight items **`DONE` in `73f6aa36`** — pure doc work, no rulings needed.

- [x] **T7.1** `phase3-completion-checklist-report.md:421` — "Uncommitted diff of **+56/−1**"
  → committed `08978034` (and it ended +56/−0).
- [x] **T7.2** `:423` — "`inventory.events.ts` and `crm.events.ts` … are **untracked**" →
  tracked (`08978034`).
- [x] **T7.3** `:36`, `:48`, `:50`, `:480`, `:569` — "7 paths uncommitted", "this report
  itself is **untracked**", `git rev-list origin/main..main → 8` → tree clean, 0 ahead.
- [x] **T7.4** §5.3 `:430-432` — `🟡 uncommitted` / `🟡 untracked inventory.events.ts` /
  `🟡 untracked crm.events.ts` → `✅`.
- [x] **T7.5** `:655` — "❌ both **untracked**" → tracked.
- [x] **T7.6** `:551` and `:564` — **remove or correct the false "filed as backlog P3-13 …
  P3-17" claim** (those entries do not exist).
- [x] **T7.7** `docs/phase3-status-report.md` §0 carries the same stale labels (`:29`,
  `:36-45`, `:53`) — reconcile identically.
- [x] **T7.8** Record `PT_EVENT_VERSION = 'v1'` as ruled/churn per commit `e2d062c2`
  (status-report Q7).

---

## Workstream 8 — The actual sign-off gate

- [x] **T8.1** — **`DONE` 2026-09-30, run at HEAD `6c3add58`** (docs-only commits since); raw
  logs `/tmp/p3gates/backend_typecheck.log` (`### EXIT=0`), `/tmp/p3gates/backend_lint.log`
  (`### EXIT=0`), `/tmp/p3gates/jest_default.log` (`Test Suites: 2 skipped, 106 passed, 106
  of 108 total` / `Tests: 5 skipped, 1114 passed, 1119 total` / `### EXIT=0`); command
  `npm run typecheck && npm run lint && npx jest --silent` on the full tree — green at the
  time (106 passed suites, 1114 passed / 5 skipped of 1119). Superseded by the 2026-10-01
  run below. Paste raw output; never summarise it.
- [x] **T8.2** — **`DONE`: RESOLVED 2026-10-01 under D16 — run locally, not in CI.** D16
  defers CI coverage (web build, Docker build, DB integration) to the separate hardening task,
  so the sign-off resolution is to RUN the gated specs against a fresh migrated scratch
  database and record it. At `89cefcd3` (plus this session's uncommitted changes): scratch DB
  `gym_t82_1790875376` created, `scripts/dev-db-env.sh --env-file <scratch.env> npm run
  migration:run` → exit 0, `SELECT count(*) FROM typeorm_migrations` → **45**; then
  `RUN_DB_INTEGRATION=1` over the three specs → **3 passed suites / 24 passed tests, exit 0**
  (`memberships-discount-renewal`, `membership-discount-ambiguity`, `inventory-tenancy` — the
  last now including the OI-2 case). The scratch DB was dropped afterwards. Note: there are
  now **three** gated suites, not the two the original row counted.
- [x] **T8.3** — **`DONE` 2026-09-30, run at HEAD `6c3add58`**:
  `/tmp/p3gates/docker_build.log` (`revision 6c3add58`, `### EXIT=0`), then the built image
  was booted (`/tmp/p3gates/api_boot_probe.log`, `/tmp/p3gates/health.json`); **build the
  production Docker stage** — `GIT_REVISION=$(git rev-parse HEAD) docker compose build api`.
  This is the *only* step that would have caught the `@aws-sdk/client-s3` devDependency
  defect (`d6aab998`); the test suite could not. Strongly recommend adding it to CI.
- [x] **T8.4** — **`DONE` 2026-09-30, run at HEAD `6c3add58`**:
  `/tmp/p3gates/mig_replay.log` (`45 migrations were found in the source code.` / `45
  migrations are new migrations must be executed.` / `### EXIT=0`), `/tmp/p3gates/mig_show.log`
  (`grep -c '\[X\]'` → `45`, `grep -c '\[ \]'` → `0`), scratch DB dropped
  (`/tmp/p3gates/mig_db_drop.log`, `/tmp/p3gates/mig_leftovers.log`).
- [x] **T8.5** — **`DONE`: pushed and verified independently with a fresh
  `git ls-remote origin refs/heads/main` compared against local `HEAD`** — not the push exit
  code. Raw output:

    ```
    $ git push origin main
    To https://github.com/gopi-AI/Gym-Management-SaaS.git
       a5a32f77..415ecc1e  main -> main
    $ git ls-remote origin main
    415ecc1e988c5d1d082fcfe151923d401942cfc6	refs/heads/main
    $ git rev-parse HEAD
    415ecc1e988c5d1d082fcfe151923d401942cfc6
    ```

  Re-confirmed 2026-09-30 at the `55b22082` baseline — the same two commands, re-read in the
  sign-off session, still agreed:

    ```
    $ git ls-remote origin refs/heads/main
    55b22082842127e28908bfb2d1c635e7ca524879	refs/heads/main
    $ git rev-parse HEAD
    55b22082842127e28908bfb2d1c635e7ca524879
    ```

  **2026-10-01 run — OUTSTANDING BY INSTRUCTION.** The owner asked for the sign-off work to
  be left uncommitted, so nothing was committed or pushed and **no `ls-remote` claim is made
  for it**. Current state, verified: `git rev-list --left-right --count origin/main...main` →
  `0	0` at `89cefcd3`, with **23 uncommitted paths** (`git status --porcelain | wc -l`).

---

## Parked items and their triggers

Nothing here is actionable today. This table exists so a future session can tell a *deliberate
deferral* from an *omission*.

| Item | Trigger that unparks it |
|---|---|
| T1.2 / T1.7 — S3 key builders + specs | A CRM-attachment or inventory-image consumer landing (D1) |
| T2.6 — lot-expiry worker | A scheduling requirement for lot expiry being accepted (D13) |
| T2.7 — inventory reorder worker, `CRM_NURTURING` | Same (D13) |
| D8 second half — trial plan source on conversion | An owner ruling; `membership_id` is `null` (`crm.service.ts:47`) and no `membership_plan_id` parameter exists |
| D9 — lead de-duplication | An owner ruling to implement (Q23 deferred) |
| D10 — loyalty redemption | A future phase; the `REDEEM` constant is reserved |
| T4.2 `EXCLUDE USING gist` alternative | Overlapping discount rows actually appearing (sweep found 0) |
| D16 hardening — ESLINT-002, web-build SIGBUS, CI coverage | The separate hardening task being scheduled |
| D17 — P2-09 Member 360 UI | Being scheduled; route and endpoint strategy are already ruled |

---

## Appendix A — Evidence ledger

Raw verification records. These are **records of runs**, not work items — kept verbatim,
including their original line references.

### Batch 8b evidence — 2026-10-01

New real-DB suite `src/inventory/services/inventory-tenancy.integration.spec.ts` (gated by
`RUN_DB_INTEGRATION=1`) seeds two orgs and proves org A cannot read org B's item / purchase
order / lots, and that a PATCH cannot re-home a row. Four-mutation matrix, each on its own
fresh scratch DB (`migration:run` → 45/45): **M1** drop the org predicate from `GET items/:id`
→ unit + integration **FAIL**; **M2** drop it from `GET lots` → both **FAIL** (B's
`ORG-B-LOT-222` leaked); **M3** drop it from `GET purchase-orders/:id` → both **FAIL** (B's
order leaked); **M4** let PATCH spread the DTO → both **FAIL** (row re-homed to B's org).
Gates: `npm run typecheck` · `npm run lint` · `npx jest --silent` (107 passed / 3 skipped /
1132 tests) · `RUN_DB_INTEGRATION=1` on `src/inventory` + `src/memberships/services` (7 suites
/ 92 passed, fresh 45/45 DB) · `GIT_REVISION=$(git rev-parse HEAD) docker compose build api`.

### Discount tie-break — first mutation matrix (2026-10-01)

`membership-discount-ambiguity.integration.spec.ts` replicates the `ORDER BY` in its own
`windowFor()` helper and reads with `discounts.findOne(...)`, so `MembershipsService` never
executes on that path — the exported constant is the only link to production, and only because
both sides import it. Measured with a four-mutation matrix (each mutation on its own fresh
scratch DB, `migration:run` → `45 migrations were found in the source code` / `45 migrations
are new migrations must be executed`, then `RUN_DB_INTEGRATION=1`):

| Mutation to `MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER` | `memberships.service.spec.ts` | `membership-discount-ambiguity.integration.spec.ts` |
|---|---|---|
| M1 `id: 'ASC'` → `id: 'DESC'` | **stayed green** (52 passed) | **FAILED** — `orders overlapping in-force rows deterministically (starts_at, created_at, id)`, at `:445` (expected `…0001`, received `…0002`) |
| M2 remove `created_at` | **stayed green** (52 passed) | **FAILED** — same test, at `:440` (expected `…0002`, received `…0001`) |
| M3 `starts_at: 'DESC'` → `'ASC'` | **stayed green** (52 passed) | **FAILED** — same test, at `:440` (expected `…0002`, received `…0003`) |
| M4 remove `starts_at` | **stayed green** (52 passed) | **FAILED** — same test, at `:440` (expected `…0002`, received `…0003`) |

All four mutations failed the integration spec, so there is no gap on that side. All four
**stayed green** on the unit spec. Line numbers are post-`0042d0f2` (before it: `:437`/`:442`).

### T4.5 mutation matrix — 2026-10-01

Re-measured on `memberships-discount-renewal.integration.spec.ts` (each mutation on its own
fresh scratch DB, `migration:run` → `45/45`, `RUN_DB_INTEGRATION=1`):

| Mutation | `memberships-discount-renewal.integration.spec.ts` |
|---|---|
| M1 remove `order` from `renewOne`'s read | **FAILED** — three-row test, fee 97.00 (the decoy) |
| M2 `starts_at: 'DESC'` → `'ASC'` | **FAILED** — three-row test, fee 97.00 (the decoy) |
| M3 remove `created_at` | **FAILED** — three-row test, fee 95.00 (the loser) |
| M4 `id: 'ASC'` → `'DESC'` | **FAILED** — id-tie test, fee 89.00 (the higher id) |

M1/M2/M3 are caught by the three-row test and M4 by the id-tie test. M1 additionally makes
the unit spec fail (`memberships.service.spec.ts:333`, `Expected:
{"created_at":"DESC","id":"ASC","starts_at":"DESC"} Received: undefined`) — but the unit spec
still does not pin the key's *contents*.

### Inventory write-path unique-constraint (23505) sweep — 2026-10-01

Swept every inventory write path that can reach a PostgreSQL unique-constraint violation
(SQLSTATE `23505`), so a client-influenced collision returns the module's own status instead
of an unhandled `QueryFailedError` (500). Verified against the DDL that actually exists:
`src/migrations/1788965263264-CreateInventorySchema.ts` is the only inventory migration that
emits DDL (`synchronize: false`, `src/data-source.ts:25`) and no later migration alters these
tables.

**Unique indexes that exist** (`CREATE TABLE` statements in that migration):

| Index | Columns | Carries `organization_id`? |
|---|---|---|
| `UQ_inventory_items_org_branch_sku` | `(organization_id, branch_id, sku)` | yes |
| `UQ_inventory_po_item` | `(po_id, inventory_item_id)` | no |
| `UQ_inventory_stock_levels` (matview) | `(organization_id, branch_id, inventory_item_id)` | yes |

Every other inventory table carries only its primary key.

**Narrowed STOP rule.** An index is a STOP only when a duplicate could be caused by a row
owned by ANOTHER organization. `UQ_inventory_po_item` is not: `po_id` is the server-generated
primary key of the purchase order created in the same request, so only repeated lines inside
one body can collide and nothing cross-organization is revealed (owner ruling, 2026-10-01).
`UQ_inventory_stock_levels` is a materialized view refreshed from already-committed rows — not
a client-supplied write.

**Mapped — client-influenced and org-scoped:**

- `createItem` (`src/inventory/services/inventory.service.ts:40`) — a `23505` on this INSERT
  can only be `UQ_inventory_items_org_branch_sku` (the PK is database-generated and an FK
  failure is `23503`), so it now reuses `isUniqueViolation` (`:200`) and throws
  `ConflictException('An inventory item with this SKU already exists in this branch')` — the
  wording `updateItem` already returned. The outbox write stays OUTSIDE the `try`, so the
  outbox's own unique key is never reported as a SKU clash.
- `createPurchaseOrder` (`:60`) — duplicate `inventory_item_id` values in `dto.items` are
  rejected with `BadRequestException('Duplicate inventory_item_id in items')` BEFORE the
  transaction opens (`:68-69`), so no `23505` reaches the driver and nothing is rolled back.
  This is a request-shape check, not a database-error path.

**Already mapped, unchanged:** `updateItem` (`:124`, mapping at `:141`) — the precedent this
sweep reuses.

**Intentionally untouched** — no client-reachable unique violation exists on them:
`createSupplier`, `receivePurchaseOrder`, `consumeStock`, and the read paths. Each either
writes a database-generated primary key only, or has no unique index beyond its PK on the
table it writes.

**Tests.** `inventory.service.spec.ts`: a mocked `QueryFailedError` `23505` on create → 409
with no outbox event; a `23503` rethrown unchanged; duplicate PO lines → 400 with
`dataSource.transaction` never called. `inventory-tenancy.integration.spec.ts` (real
Postgres): same org + branch + sku → 409 with the row count unchanged; the same sku in a
different org and in a different branch of the same org both succeed; duplicate PO lines →
400 with the purchase-order count unchanged; distinct lines still create a purchase order.

### Phase 3 sign-off run — 2026-10-01

Executed against `main` @ `89cefcd3` plus the uncommitted sign-off work in the working tree.
Every figure below is a raw command result from that tree.

**Gates (T8.1).**

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `npm run typecheck` | `EXIT=0` |
| Lint | `npm run lint` | `EXIT=0` |
| Web typecheck | `cd apps/web && npm run typecheck` | `EXIT=0` |
| Backend tests | `npx jest --silent` | `Test Suites: 3 skipped, 109 passed, 109 of 112 total` / `Tests: 24 skipped, 1168 passed, 1192 total` / `EXIT=0` (the `force exited` teardown warning appeared; exit code 0 — the known intermittent leak) |
| Integration specs (T8.2) | `RUN_DB_INTEGRATION=1` on a fresh migrated scratch DB | `3 passed suites / 24 passed tests`, `EXIT=0`; migrations `45/45` |
| Production image (T8.3) | `GIT_REVISION=$(git rev-parse HEAD) docker compose build api` | `EXIT=0`; `#21 DONE 9.3s` / `Image gym-management-saas-api Built`; `docker images` → `gym-management-saas-api:latest 612MB` |
| Migration replay from zero (T8.4) | app boot on an empty scratch DB inside the gate (`DB_MIGRATIONS_RUN=true`) | `boot-02`: `typeorm_migrations rows=45, files=45` |
| Push (T8.5) | — | No commit or push made — see T8.5 |

**The D15 gate.** `scripts/api-gate.js` (+ `scripts/api-gate.spec.ts`, 13 hermetic tests;
`npm run api:gate`). First full run: **9 failures**, all `403 Organization context required`
in inventory and CRM — the defect recorded in §15.2 of the scoping plan. After the fix:
**69/69 checks pass, exit 0**, scratch database and Redis index dropped by the gate itself.

**The D14 review.** `docs/phase3-security-review.md` — one High finding fixed in-pass with a
mutation-verified spec; six findings filed as `DEF-02`, `DEF-04`–`DEF-08`; `DEF-03` filed
from the gate's own bring-up. See the review for the full disposition and its "not covered"
list.

**Unruled items remaining after this run:** none of the Phase 3 decision items. The findings
filed as `DEF-xx` and the D16 hardening track (ESLINT-002, the web-build SIGBUS, CI coverage)
are deliberately outside Phase 3 scope.

---

## Appendix B — Findings

### Out-of-scope findings

Verified; deliberately **not** fixed — each would touch the backlog's phase ordering (an owner
concern) or an unruled area. **Line numbers re-verified 2026-10-01.**

- **Duplicate `### P0-03` headings** in `docs/task-backlog.md` — at lines **`36` and `1973`**
  (`grep -n '^### P0-03' docs/task-backlog.md`).
- **Non-numeric backlog ordering** in `docs/task-backlog.md` for P0/P1/P2/P4/P5/P6/P7 —
  e.g. `P0-07`→`P0-10` (`:168`→`:175`, with `P0-08`/`P0-09` later at `:1761`/`:1786`),
  `P1-02`→`P1-05` (`:239`→`:245`, `P1-03`/`P1-04` later at `:1652`/`:1688`),
  `P2-06`→`P3-01` (`:357`→`:383`, `P2-03`/`P2-04` later at `:1521`/`:1543`),
  `P4-06`→`P5-01` (`:671`→`:687`, `P4-03`/`P4-04` later at `:1281`/`:1304`),
  `P5-05`→`P6-01` (`:753`→`:769`, `P5-03` later at `:1136`),
  `P6-05`→`P7-01` (`:836`→`:851`, `P6-03` later at `:1033`),
  `P7-05`→`P7-03` (`:914`→`:969`). Phase 3 is the only phase in numeric order (`1608cb31`).

### Findings from the 2026-09-30 sign-off run

Dated observations from the sign-off run at HEAD `6c3add58` (raw logs under `/tmp/p3gates/`).
**Not fixed here** — each is a CI/process change, an owner decision, or an unruled area;
recording them is the deliverable. Each item carries the command that shows it, and each is
**corrected in place** where a later ruling or artifact superseded it.

1. **ESLINT-002 — `apps/web` lint exits 1.** `cd apps/web && npm run lint` → `### EXIT=1`
   (`/tmp/p3gates/web_lint.log`): `next lint` aborts with `Invalid Options: Unknown options:
   useEslintrc, extensions, …` (eslint 10 paired with `eslint-config-next@16`; no ESLint
   config exists under `apps/web`). Open — not a skip that can be read as green. **→ Now
   tracked under D16.**
2. **`apps/web` production build aborts with `SIGBUS`, 3/3 attempts, unattributed.**
   `cd apps/web && npm run build` → `Next.js build worker exited with code: null and signal:
   SIGBUS` (`/tmp/p3gates/web_build.log`, `/tmp/p3gates/web_build_retry.log`; the third
   attempt — `NODE_OPTIONS=--max-old-space-size=3072 npx next build` — was run without a
   captured log file). No compile/type error accompanies it, and the host was short on memory
   (~890 Mi free, 2.8 Gi swap in use) at the time. **Unconfirmed on a clean machine;
   deliberately not attributed to the code. → Now tracked under D16.**
3. **CI covers none of the heavy gate steps.** `grep -cniE 'next build|docker|
   RUN_DB_INTEGRATION' .github/workflows/ci.yml` → `0`; the workflow runs only `npm ci`,
   backend typecheck, backend lint, `cd apps/web && npm run typecheck`, and `npx jest
   --passWithNoTests`. There is **no web build, no Docker build and no DB-integration run in
   CI**. **→ Now tracked under D16.**
4. ~~**No Phase 3 security-review artifact.**~~ **RESOLVED 2026-10-01 by D14.** A Phase 3
   security review now exists at **`docs/phase3-security-review.md`** (owner decision §15.2
   D14 — performed) — one High finding fixed in-pass with a mutation-verified spec;
   the remainder filed as `DEF-02`, `DEF-04`–`DEF-08`, with `DEF-03` from the gate's bring-up.
   `ls docs/ | grep -iE 'security|audit|review'` → `phase3-security-review.md`,
   `security-plan.md`.
5. **No E2E gate.** `grep -rn '"test:e2e"' package.json apps/web/package.json` → no match;
   `git ls-files | grep -c playwright.config` → `0`. **Partially superseded 2026-10-01 by
   D15:** an API/integration gate now exists (`scripts/api-gate.js`, `npm run api:gate`, 69
   checks), and browser E2E was **deliberately ruled out of Phase 3** — so this is a ruling,
   not a gap. The pre-existing `apps/web/__tests__/browser-verify.mjs` still needs a running
   API and seeded credentials and was not run.
6. ~~**P3-10, P3-11 and P3-12 have no backlog entries.**~~ **NO LONGER TRUE — corrected
   2026-10-01.** All three exist: `grep -nE '^### P3-1[0-2]' docs/task-backlog.md` →
   `:1439` (P3-10 Object Storage Configuration), `:1473` (P3-11 PT Enrollment Cancellation &
   Commission Clawback), `:1509` (P3-12 PT Commission Payout Runs). What remains true is the
   narrower claim: **`P3-13` … `P3-17` have no entries** — `grep -nE '^#{2,3} P3-1[3-7]'
   docs/task-backlog.md` → no match, and the only mentions of those IDs in `docs/` are the two
   false claims corrected by T7.6.
7. ~~**P2-09 needs an owner decision — on the route, and on whether its tabs call the
   existing per-domain endpoints.**~~ **RESOLVED 2026-10-01 by D17** (§15.2 D17): the
   route is `apps/web/src/app/members/[id]/page.tsx` with tab child routes; the tabs call
   **existing per-domain endpoints** plus `GET /v1/members/:memberId/360/header`
   (`src/members/controllers/member-360.controller.ts:23,37`); **no new 360 endpoints**. P2-09
   remains **carried over, unscheduled** — the ruling settles its shape, not its scheduling.
   The placeholder route still does not exist (`ls apps/web/src/app/members/` → `page.tsx`
   only).
8. **P2-03 and P2-08 cite paths that do not exist.** P2-03 (`docs/task-backlog.md:1525`) cites
   `src/scheduling/`; P2-08 (`:1466`) cites `src/notifications/ or src/members/`. `ls -d
   src/scheduling src/notifications` → *No such file or directory* for both. The points
   service actually lives under `src/loyalty/`, and enrollments under `src/pt/`. **Still
   true.**
