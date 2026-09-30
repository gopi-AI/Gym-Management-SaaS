# Phase 3 Completion Plan

**Baseline:** `a5a32f77` (2026-09-30). Every claim in this document was verified
against that commit and the working tree, not taken from the reports' prose.
**Purpose:** the task list required before "Phase 3 is complete" can be asserted.
**Split:** Workstream 0 items are decisions an owner/architect must make — a coding
agent must not invent them (`.clinerules`: REPOSITORY IS LAW). Workstreams 1–8 are
executable, subject to the Workstream 0 rulings they depend on.

Here's the checklist, built from what I just verified at `a5a32f77` — not from the docs' prose. I've split it into **decisions an agent must not invent** (owner/architect) versus **work a coding agent can execute**, because about two-thirds of the remaining gap is rulings, not code.

Two corrections to the record that shape the list, verified this turn:
- **`P3-13 … P3-17` do not exist.** `grep -n '^### P3-1' docs/task-backlog.md` → no match. The checklist report claims twice (`:551`, `:564`) that they were "filed 2026-09-29 as backlog P3-13 … P3-17 in `docs/task-backlog.md`". The only occurrences of those IDs anywhere in `docs/` are those two claims.
- **Plan §15 has 23 questions and only 6 `Decision` lines** — Q4–Q9 ruled; **Q1, Q2, Q3, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20, Q21, Q22, Q23 open.** Several are *implemented but unrecorded*, so the task is a `Decision` line, not code.

---

## Workstream 0 — Decisions required before "complete" can be asserted

| ID | Question | Verified current state | Unblocks |
|---|---|---|---|
| **D1** | Plan §15 **Q10** — does the P3-10 S3 gap now have priority? | plan §10 §12.1 row 12 still says "Opportunistic; not a blocker" | Workstream 1 |
| **D2** | Plan §15 **Q8** — discount ownership direction (needs a `Decision` line) **and** the tie-break rule when two discount windows are in force | Three reads have **no `ORDER BY`**: `memberships.service.ts:460-467` (`renewOne`), `:715-722` (`create`), `:814-821` (`addDiscount`). Which row wins is heap order — `membership-discount-ambiguity.integration.spec.ts` pins that behaviour but does not fix it. **Confirmed-unfixed defect.** | Workstream 4 |
| **D3** | Plan §15 **Q11** — gateway provider selection | Stripe adapter shipped (`stripe-payment-gateway.adapter.ts`); unrecorded | paper only |
| **D4** | Plan §15 **Q13** (renewal trigger) **+** status-report Q8 — is an operator renewal route required? | `renew` = **0** occurrences in every membership controller; renewal is service/worker-only (`membership-expiry.worker.ts:37`) | Workstream 3 |
| **D5** | Plan §15 **Q14(a)/(b)** — dunning counter owner; fixed vs exponential schedule | code shipped, semantics unruled | paper only |
| **D6** | Plan §15 **Q16** — all-or-nothing vs pro-rata clawback | all-or-nothing shipped (one row per enrollment) | paper only |
| **D7** | Plan §15 **Q19/Q21** — inventory costing; per-branch stock | FIFO shipped; `inventory-item.entity.ts:8` has `branch_id` | Workstream 2 |
| **D8** | Plan §15 **Q22** — member auto-creation on conversion (a/b/c) | `POST /v1/leads/:id/convert` shipped; unruled | paper only |
| **D9** | Plan §15 **Q23** — lead de-duplication | `lead.entity.ts` has `phone`/`email` with **no unique index** → not implemented | new work |
| **D10** | Plan §15 **Q18** — loyalty redemption in Phase 3? | `loyalty.constants.ts:32 REDEEM: 'redeem'` exists; entity docblock says `lifetime_points_redeemed` "remains 0 in Phase 2 (redemption deferred…)" | scope |
| **D11** | Recording-only tallies, each needing a `Decision` line | Q1 ledger views (plain `V_*` shipped), Q2 period locking (**no hits** — not built), Q3 reporting permission (**no hits** — reuse today), Q12 webhook model (`webhook-event.worker.ts` shipped ⇒ persisted+worker), Q15 payout schema (`CommissionPayoutRun`/`Item` shipped), Q17 `pt.events.ts` (**exists**), Q20 stock derived (**no `stock` column** on `inventory-item.entity.ts` ⇒ derived) | paper only |
| **D12** | **The five `implementation-roadmap.md` §Phase 3 frontend deliverables — in or out?** inventory UI, CRM pipeline/lead management, advanced financial reports, trainer commission statements, refund/credit-note UI | **none exists**; `grep -rniE 'inventory\|crm\|dunning\|commission-payout' apps/web/src \| wc -l` → **0**; no backlog entry exists for any of them; every backlog `Frontend changes:` line reads "None (API only in this phase)" | Workstream 6 — **largest single chunk** |
| **D13** | P3-05 workers + `CRM_NURTURING` — build or formally descope? | `src/shared/workers/` has background-worker, crm-follow-ups, crm-sla-monitor, dunning, membership-expiry, outbox, payment-retry, webhook-event — **no inventory worker of any kind** | Workstream 2, 3 |

---

## Workstream 1 — P3-10 Storage configuration *(agent-executable once D1 is ruled in scope)*

Every one of plan §10's "Files to change" rows is still at zero:
```
@Global() on S3Module:                    ABSENT
buildCrmAttachmentKey/InventoryImageKey:  ABSENT
S3/AWS/bucket vars in .env.example:       0
SharedModule:                             ABSENT
```

- [ ] **T1.1** `src/shared/storage/s3.module.ts` — add `@Global()`, or introduce a `SharedModule` re-exporting `S3Module` (plan §10 rec 2; plan notes `@Global()` is the smaller change). Pick one, don't do both.
- [ ] **T1.2** `src/shared/storage/s3.service.ts` — add `buildCrmAttachmentKey()` (`orgs/{orgId}/crm/leads/{leadId}/{uuid}/{fileName}`) and `buildInventoryImageKey()`. **Do not change `buildKey()`'s 4-argument signature** — `documents.service.spec.ts` asserts it is called with exactly four arguments.
- [ ] **T1.3** `.env.example` — add `S3_LOCAL_ROOT`, `S3_DOCUMENTS_BUCKET`, `AWS_REGION`. Note the file already groups sections with `# ── … ──` banners; add a matching one. The service defaults are `./uploads`, `gym-documents`, `us-east-1` (`s3.service.ts:33,46,48`).
- [ ] **T1.4** Decide the `process.env` vs `ConfigService` inconsistency (plan §10's "fourth, minor inconsistency") — record the choice; do not change it silently.
- [ ] **T1.5** Wire `S3Module` into `crm.module.ts` / `inventory.module.ts` only if T1.1 chose `SharedModule`.
- [ ] **T1.6** Any new consumer must keep the **S3-upload-first, DB-insert-second** order with best-effort `delete()` on DB failure (plan §10 rec 4, documented at `s3.service.ts:8-14`).
- [ ] **T1.7** Specs for both new key builders + the new consumers, mirroring `documents.service.spec.ts`.
- [ ] **T1.8** Consider `uploads/` in `.gitignore` — it is currently absent from `.gitignore`, so a local-dev upload surfaces as untracked noise.

**Acceptance:** `grep -q '@Global' src/shared/storage/s3.module.ts` (or `SharedModule` exists); both builders exist and are unit-tested; `.env.example` has the three vars; `npm run typecheck && npm run lint && npx jest --silent` green.

---

## Workstream 2 — P3-05 Inventory gaps

Backlog asks for 8 item endpoints; 4 are missing. Registered today: `GET/POST suppliers`, `GET/POST items`, `GET/POST purchase-orders`, `POST purchase-orders/:id/receive`, `GET stock`, `POST transactions/consume`.

- [ ] **T2.1** `GET /v1/inventory/items/{id}` — org-scoped, `inventory:read`
- [ ] **T2.2** `PATCH /v1/inventory/items/{id}` — org-scoped, `inventory:update`; no entity spreading on update (`.clinerules` §3)
- [ ] **T2.3** `GET /v1/inventory/lots` (paginated, filterable) — `inventory:read`; note `INVENTORY_INVENTORY_LOTS` lacks `organization_id`, so org-scoping requires the join through `inventory_items` (plan §7 problem 2)
- [ ] **T2.4** `GET /v1/inventory/purchase-orders/{id}` — `inventory:read`
- [ ] **T2.5** Decide `POST /v1/inventory/transactions` vs the shipped `POST transactions/consume` — either align or record the deviation (bidirectional divergence is already flagged at report `:671`)
- [ ] **T2.6** Lot-expiry worker (or descope per **D13**)
- [ ] **T2.7** Inventory reorder worker (or descope per **D13**) — and add both to `worker-config.ts` + `.env.example`'s `WORKERS_*` block if built
- [ ] **T2.8** Record D7 in plan §15

**Acceptance per endpoint:** route registered, org predicate on every query, branch cross-check where `branch_id` is accepted, controller + service specs, gates green.

---

## Workstream 3 — P3-09 operator renewal surface *(pending D4)*

- [ ] **T3.1** If an operator route is required: add it on the memberships controller, reusing `renewOne` — do **not** create a second payment path. Reuse the existing idempotency key `membership-renewal:{membershipId}:{renewalDate}` (`memberships.service.ts:423`).
- [ ] **T3.2** Spec it, including a cross-org rejection case in the style of `memberships.service.spec.ts:380`.
- [ ] **T3.3** If instead the ruling is worker-only, record that as the §15 Q13 `Decision` — the code needs no change.

---

## Workstream 4 — P3-04b residuals *(tie-break pending D2)*

- [ ] **T4.1** `src/memberships/entities/membership-discount.entity.spec.ts` — no `src/memberships/entities/*.spec.ts` exists (`create-membership-discount.dto.spec.ts` does).
- [ ] **T4.2** Fix the tie-break (D2). Either add an explicit `order` to all three reads, **or** add a real overlap constraint (`EXCLUDE USING gist (membership_id WITH =, tstzrange(starts_at, COALESCE(ends_at,'infinity')) WITH &&)`) — note the latter needs `btree_gist`, needs `ends_at IS NULL` normalized, and needs a repair step only if overlapping rows exist (the sweep found **0 rows in every reachable DB**, so there is currently nothing to repair).
- [ ] **T4.3** If a tie-break is chosen, also decide what happens when the key itself ties (identical `starts_at` / `created_at` / `amount` are all reachable).
- [ ] **T4.4** Decide whether `MembershipDiscountApplied` should exist — the Doc 1 row (`:421`) records it as absent and notes no such event exists in code.

---

## Workstream 5 — Documented §12.3 prerequisites

- [x] **T5.1** `docs/database-plan.md` — add the tables the Doc 2 row (`:419`) lists as missing: `FINANCE_WEBHOOK_EVENTS`, `FINANCE_PAYMENT_METHODS`, `FINANCE_DUNNING_ATTEMPTS`, `FINANCE_INVOICE_DISCOUNTS`, `CRM_SLA_POLICIES`, `CRM_SLA_BREACHES` (done in `3090573b`), plus the real payout pair `PT_COMMISSION_PAYOUT_RUNS` / `PT_COMMISSION_PAYOUT_ITEMS` (done in `33a14f3a`) — `PT_COMMISSION_PAYOUTS` was never a real table.
- [x] **T5.2** `.env.example` — add `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (status-report Q3) — done in `287faeec`.
- [x] **T5.3** `docs/task-backlog.md` — add the missing backlog items: recurring billing (P3-09) and dunning (P3-08) — done in `cb51f0ca`; rejoin the displaced P3-02 and P3-06 bodies — done in `e241aaac`; fix the P3-03/P3-04/P3-04b ordering — done in `1608cb31`.

---

## Workstream 6 — Frontend *(pending D12; the largest chunk)*

If D12 rules **in scope**, five deliverables, none of which exists:

- [ ] **T6.1** Inventory management UI
- [ ] **T6.2** CRM pipeline + lead management
- [ ] **T6.3** Advanced financial reports
- [ ] **T6.4** Trainer commission statements
- [ ] **T6.5** Refund/credit-note processing UI

Each must follow the existing web conventions: App Router under `apps/web/src/app/`, React Query via **dedicated custom hooks only** (no fetching inside components), API modules mirroring `apps/web/src/lib/*-api.ts`, and the backlog entry must be created first (the claimed P3-13…P3-17 do not exist).

If D12 rules **out of scope**, the task is one line: record the descope in `implementation-roadmap.md` §Phase 3 and `docs/task-backlog.md` so Phase 3's "API-only" boundary is a decision rather than an omission.

---

## Workstream 7 — Documentation reconciliation *(agent-executable now, no rulings needed)*

- [x] **T7.1** (done in `73f6aa36`) `phase3-completion-checklist-report.md:421` — "Uncommitted diff of **+56/−1**" → committed `08978034` (and it ended +56/−0).
- [x] **T7.2** (done in `73f6aa36`) `:423` — "`inventory.events.ts` and `crm.events.ts` … are **untracked**" → tracked (`08978034`).
- [x] **T7.3** (done in `73f6aa36`) `:36`, `:48`, `:50`, `:480`, `:569` — "7 paths uncommitted", "this report itself is **untracked**", `git rev-list origin/main..main → 8` → tree clean, 0 ahead.
- [x] **T7.4** (done in `73f6aa36`) §5.3 `:430-432` — `🟡 uncommitted` / `🟡 untracked inventory.events.ts` / `🟡 untracked crm.events.ts` → `✅`.
- [x] **T7.5** (done in `73f6aa36`) `:655` — "❌ both **untracked**" → tracked.
- [x] **T7.6** (done in `73f6aa36`) `:551` and `:564` — **remove or correct the false "filed as backlog P3-13 … P3-17" claim** (those entries do not exist).
- [x] **T7.7** (done in `73f6aa36`) `docs/phase3-status-report.md` §0 carries the same stale labels (`:29`, `:36-45`, `:53`) — reconcile identically.
- [x] **T7.8** (done in `73f6aa36`) Record `PT_EVENT_VERSION = 'v1'` as ruled/churn per commit `e2d062c2` (status-report Q7).

---

## Workstream 8 — The actual sign-off gate

- [ ] **T8.1** `npm run typecheck && npm run lint && npx jest --silent` on the full tree — currently green (106 passed suites, 1114 passed / 5 skipped of 1119). Paste raw output; never summarise it.
- [ ] **T8.2** The two DB integration specs report **SKIPPED** unless `RUN_DB_INTEGRATION=1` (that is why `npx jest` shows 2 skipped suites). If they are part of the gate, CI needs a migrated scratch database — today they prove nothing in a default run.
- [ ] **T8.3** **Build the production Docker stage** — `GIT_REVISION=$(git rev-parse HEAD) docker compose build api`. This is the *only* step that would have caught the `@aws-sdk/client-s3` devDependency defect (`d6aab998`); the test suite could not. Strongly recommend adding it to CI.
- [ ] **T8.4** Re-run migration replay from zero (45/45 apply) and drop the temp DB.
- [x] **T8.5** (done 2026-09-30) Pushed and verified independently with a fresh `git ls-remote origin refs/heads/main` compared against local `HEAD` — not the push exit code. Raw output:

    ```
    $ git push origin main
    To https://github.com/gopi-AI/Gym-Management-SaaS.git
       a5a32f77..415ecc1e  main -> main
    $ git ls-remote origin main
    415ecc1e988c5d1d082fcfe151923d401942cfc6	refs/heads/main
    $ git rev-parse HEAD
    415ecc1e988c5d1d082fcfe151923d401942cfc6
    ```

---

## Suggested execution order

1. **D1–D13 rulings** (owner). T7.1–T7.8 can run in parallel — pure doc work, no rulings.
2. **T5.1–T5.3** (`.env.example`, database-plan, backlog) — cheap, unblocks discoverability.
3. **Workstream 1** (P3-10) once D1 says in-scope.
4. **Workstream 2** endpoints, then workers if D13 says build.
5. **Workstream 3** (D4-dependent) and **Workstream 4** (D2-dependent) — both small.
6. **Workstream 6** (D12-dependent) — the big one; only if in scope.
7. **Workstream 8** gate, then record completion.

**Guardrails for the agent** (from `.clinerules`, worth restating because most of these touch tenancy): no invented entities/routes/permissions; org id never from client input; every read/write preserving the org boundary with `branchId`/`memberId` validated against it; outbox rows written in the **same** TypeORM transaction as the business change and never published directly; no parallel auth/tenancy system; no raw SQL unless the task requires it; don't weaken `buildKey()`'s signature; and **do not invent a ruling** — if a Workstream-0 item is unruled, stop and report rather than choose.

---

## Out-of-scope findings

Verified this run; deliberately **not** fixed — each would touch the backlog's phase
ordering (an owner concern) or an unruled area, and no ruling was made:

- **Duplicate `### P0-03` headings** in `docs/task-backlog.md` — at lines `36` and `1858`
  (`grep -n '^### P0-03' docs/task-backlog.md`).
- **Non-numeric backlog ordering** in `docs/task-backlog.md` for P0/P1/P2/P4/P5/P6/P7 —
  e.g. `P0-07`→`P0-10` (`:168`→`:175`, with `P0-08`/`P0-09` later at `:1761`/`:1786`),
  `P1-02`→`P1-05` (`:239`→`:245`, `P1-03`/`P1-04` later at `:1652`/`:1688`),
  `P2-06`→`P3-01` (`:357`→`:383`, `P2-03`/`P2-04` later at `:1521`/`:1543`),
  `P4-06`→`P5-01` (`:671`→`:687`, `P4-03`/`P4-04` later at `:1281`/`:1304`),
  `P5-05`→`P6-01` (`:753`→`:769`, `P5-03` later at `:1136`),
  `P6-05`→`P7-01` (`:836`→`:851`, `P6-03` later at `:1033`),
  `P7-05`→`P7-03` (`:914`→`:969`). Phase 3 is the only phase in numeric order (`1608cb31`).
