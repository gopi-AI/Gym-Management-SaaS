# PHASE 2 — DEMO / PRODUCT READINESS VERIFICATION REPORT

**Date:** 2026-09-14
**Scope:** End-to-end demo/product-readiness validation of the completed Phase 2 surface (identity, tenancy, memberships, AI) — API, database, build provenance, and browser UI.
**Method:** Runtime verification against the live stack (NestJS API + real PostgreSQL 16 + Redis 7 + Next.js web client at `localhost:3001`), plus automated suites (`jest`, `tsc`) and browser automation (Playwright/Chromium).
**Nature of this task:** **Validation only.** No application source was modified. One new report file was added.

**Verdict:** ⚠️ **FUNCTIONALLY READY — NOT DEMO-READY AS SHIPPED.**

All Phase 2 **functional** behaviour passed: 439/439 unit/integration tests, both TypeScript projects clean, every API endpoint and lifecycle transition correct, cross-tenant isolation enforced, and **0 console / 0 page errors** in the browser.

However, one **High-severity presentation defect** blocks a credible demo: **the entire left navigation sidebar is invisible at every viewport (375 → 1920 px)**, so a demo operator has **no in-app navigation** and must type URLs manually. Root cause is fully diagnosed and causally proven (see Finding **F1**); the fix is a one-attribute change.

Two Low-severity items were also recorded (F2, F3), both non-functional.

---

## 1. Artifact and environment under test

| Item | Value |
|---|---|
| Repository | `Gym-Management-SaaS` (git working tree, not committed) |
| API container | `gym-api` — `Up 2 hours`, `node dist/main.js`, port `3000` |
| Database | `gym-postgres` — Postgres 16, `Up 2 hours (healthy)` |
| Cache | `gym-redis` — Redis 7, `Up 2 hours (healthy)` |
| Web client | `apps/web` — Next.js dev server, port `3001`, `GET /login` → **200** |
| API health | `GET /v1/health` → **200** |
| Demo tenant (Org A) | `9fb65b8b-f9f8-48ef-a09d-e38a7d8deb0c` — "Development Gym" |
| Isolation tenant | "Isolation Test Org 1789120003804" (test user has no membership) |
| Demo user | `test2@example.com` (owner) |
| Layout shell | `apps/web/src/components/layout/{AppLayout,Sidebar,Navbar}.tsx` |
| Styling source | `apps/web/src/app/globals.css` → **CDN `@import` of `@tabler/core@latest`** |
| Local Tabler package | `node_modules/@tabler/core` = **1.5.1** |
| `@tabler/core@latest` (CDN) | **1.5.1** (verified via `cdn.jsdelivr.net/npm/@tabler/core@latest/package.json`) |


## 2. Automated suite results

| Suite | Command | Result |
|---|---|---|
| Unit / integration | `npx jest --passWithNoTests` | ✅ **40/40 suites, 439/439 tests passed**, `EXIT:0`, 203.3 s |
| API typecheck | `npm run typecheck` (`tsc --noEmit -p tsconfig.spec.json`) | ✅ `EXIT:0`, no diagnostics |
| Web typecheck | `cd apps/web && npm run typecheck` (`tsc --noEmit -p tsconfig.json`) | ✅ `EXIT:0`, no diagnostics |

Expected, benign log noise during Jest (deliberate negative-path tests, all asserting correct fail-closed behaviour):
`AI_NOT_CONFIGURED`, `AI_DISABLED`, `AI_INVALID_API_KEY`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_MALFORMED_RESPONSE`, `Redis connection refused` (blacklist fail-closed), `READONLY … replica`. No unexpected failures.

---

## 3. Browser demo-flow results (Playwright / Chromium, 1280×720)

**Totals: 23/25 checks passed · `CONSOLE_ERRORS=0` · `PAGE_ERRORS=0`**

| # | Demo step / check | Result | Evidence |
|---|---|---|---|
| 1 | Protected route `/memberships` redirects to `/login` when logged out | ✅ PASS | → `http://localhost:3001/login` |
| 2 | Login page renders email + password form | ✅ PASS | form present |
| 3 | Negative login rejected with user-facing error | ✅ PASS | `status 401`, alert `"Invalid credentials"` |
| 4 | Positive login redirects to `/dashboard` | ✅ PASS | → `/dashboard` |
| 5 | Select "Development Gym" via org switcher | ✅ PASS | `Use` clicked + Active badge |
| 6 | Dashboard renders | ✅ PASS | members card populated |
| 7 | Membership plans page loads with rows | ✅ PASS | `Final Gate Demo Plan` visible |
| 8 | Membership plans API 200 with tenant header | ✅ PASS | `status 200` |
| 9 | **Create plan via UI** | ✅ PASS | `status 201`, id `90571c22-c5d9-43d2-8aae-2583df5a95bd` |
| 10 | **Create membership via UI** | ✅ PASS | `status 201`, id `064afa31-f6ca-454f-aba3-d12f98c3478d` |
| 11 | Lifecycle: pause | ✅ PASS | `status=paused` |
| 12 | Lifecycle: resume | ✅ PASS | `status=active` |
| 13 | Lifecycle: freeze | ✅ PASS | `status=frozen` |
| 14 | Lifecycle: unfreeze | ✅ PASS | `status=active` |
| 15 | Lifecycle: cancel | ✅ PASS | `status=cancelled` |
| 16 | Retention analysis via UI returns contract | ✅ PASS | `status 200`, org `9fb65b8b…` |
| 17 | Retention results render | ✅ PASS | at-risk table rendered |
| 18 | Plan performance via UI returns contract | ✅ PASS | `status 200`, org `9fb65b8b…`, 10 recommendations |
| 19 | Plan performance results render | ✅ PASS | "Recommendations" section |
| 20 | AI usage page loads org-scoped usage + limits | ✅ PASS | `status 200`, limits `{20 req/min, 60 s, 200000 tokens, $25}` |
| 21 | Foreign-tenant membership read blocked | ✅ PASS | `status 403` |
| 22 | Foreign tenant does not leak Org A data | ✅ PASS | no dev data rendered |
| 23 | Switching back to Org A restores scoped data | ❌ **FAIL (false negative — see F3)** | assertion mismatch; product works |
| 24 | Reload keeps authenticated product state | ✅ PASS | still on `/dashboard` |
| 25 | Sign out returns to `/login` | ❌ **FAIL (caused by F1)** | `.navbar` locator timed out on hidden sidebar |

Checks **23** and **25** are **not product failures** — both are proven below to be **harness defects** whose root cause is the duplicate `aria-label` / duplicated `.navbar` markup, compounded by the invisible sidebar (F1).

---

## 4. Findings

### F1 — HIGH · The entire vertical sidebar is invisible at every viewport (demo blocker)

**Symptom.** On every authenticated page (`/dashboard`, `/settings`, `/members`, `/memberships`, `/organizations`, …) the Tabler vertical sidebar is rendered in the DOM but never painted. A demo operator therefore has **no in-app navigation**: no Dashboard / Members / Branches / Organizations / Membership Plans / Memberships / Retention / Plan performance / AI usage / Settings links, and no sidebar user footer / sign-out.

**Reproduced at four viewports** — sidebar `<aside class="navbar navbar-vertical navbar-expand-lg">` computed `display: none`, box `0×0`, while `header.navbar` was `display: flex`:

| Viewport | `aside` display | `aside` size | Visible sidebar nav links (of 12) | `header` display |
|---|---|---|---|---|
| 1920×1080 desktop | `none` | 0×0 | **0** | `flex` |
| 1280×720 laptop | `none` | 0×0 | **0** | `flex` |
| 991×800 tablet | `none` | 0×0 | **0** | `flex` |
| 375×800 mobile | `none` | 0×0 | **0** | `flex` |

Tapping the header's hamburger (`Toggle navigation`, `data-bs-target="#navbar-menu"`) at 375 px also revealed **0** product links, because those links live in the *sidebar's* `#sidebar-menu`, not in `#navbar-menu` (which is deliberately empty — see the `<nav aria-label="Primary" />` placeholder in `Navbar.tsx`). So at mobile there is no navigation path at all.

**Root cause.** `AppLayout.tsx` renders **both** a vertical sidebar and a top navbar:

```tsx
<div className="page">
  <Sidebar activeMenu={pageMenu} />   {/* <aside class="navbar navbar-vertical navbar-expand-lg"> */}
  <Navbar  activeMenu={pageMenu} />   {/* <header class="navbar navbar-expand-md"> */}
  …
```

Tabler **1.5.1** (present in `@tabler/core@1.4.0` but **absent in 1.5.0/1.5.1**) ships this rule:

```css
html:not([data-bs-navbar-position=vertical])
  .page:has(> [class*=navbar-expand]:not(.navbar-vertical))
  > .navbar-vertical { display: none }
```

The app never sets `data-bs-navbar-position`, so the `:not(...)` branch matches and Tabler treats the page as a **horizontal** layout — hiding the vertical sidebar — and the auto-detection must be opted into explicitly via a static `data-bs-navbar-position="vertical"` attribute on `<html>`.

`grep -rn 'navbar-position\|navbarPosition' apps/web/src` → **no matches**; the attribute is also absent from `apps/web/src/app/layout.tsx`, whose `<html>` carries only `lang`, `data-bs-theme` and `data-theme`. The attribute cannot be added by Tabler's JS either (no occurrence in `dist/js/tabler.js`), and it must be present **before React hydration**, so it belongs in the server-rendered `<html>` tag.

**Causal proof #1 — post-hydration attribute flip (same page, same CSS, one variable):**

| State | `<html data-bs-navbar-position>` | `aside` display / width | `header` display | Visible links |
|---|---|---|---|---|
| Before | `null` | `none` / `0px` | `flex` | `/members` 0, `/memberships` 0, `/ai-usage` 0, `/settings` 0 |
| After (attribute set) | `vertical` | **`flex` / `256px`** | **`none`** | `/members` **1**, `/memberships` **1**, `/ai-usage` **1**, `/settings` **1** |

All four previously invisible sidebar links became visible with the *only* change being that attribute — and the top navbar correctly switched off, matching Tabler's `html[data-bs-navbar-position=vertical] .page:has(> .navbar-vertical) > [class*=navbar-expand]:not(.navbar-vertical) { display: none }`.

**Causal proof #2 — stylesheet version swap (isolates the regression to the CDN bump).** Logging in normally, then intercepting the CDN stylesheet and reloading with a pinned copy:

| Tabler CSS served | `aside` display / width | Visible `/members`, `/memberships`, `/settings` |
|---|---|---|
| **1.4.0** | **`flex` / 240px** | **1, 1, 1** |
| **1.5.1** | `none` / 0px | 0, 0, 0 |
| **`@latest`** (= 1.5.1) | `none` / 0px | 0, 0, 0 |

Selector presence per version (extracted from the published CSS): **absent in 1.0.0 and 1.4.0, present in 1.5.1.** The screenshot for 1.4.0 shows the full sidebar (brand, Overview/Management/System sections, 9 nav items, user footer); for 1.5.1 the sidebar area is blank.

**Why this is a latent regression, not a typo.** `apps/web/src/app/globals.css` pulls the framework from a **floating CDN tag**:

```css
@import 'https://cdn.jsdelivr.net/npm/@tabler/core@latest/dist/css/tabler.min.css';
@import 'https://cdn.jsdelivr.net/npm/@tabler/core@latest/dist/css/tabler-vendors.min.css';
```

`@latest` resolved to 1.5.1, which introduced the layout-mode requirement. The pinned dependency in `package.json` (`@tabler/core` 1.5.1) is **not actually used for styling** — the browser never loads it. Consequence: the app's appearance can change on any jsDelivr cache refresh with **zero commits**, and the build is not reproducible or offline-capable. Two independent fixes are required (markup + pinning).

**Recommended fix (two parts).**

1. **Declare the layout mode** in `apps/web/src/app/layout.tsx` (server-rendered, present before hydration):

```tsx
<html lang="en" data-bs-theme="light" data-theme="light" data-bs-navbar-position="vertical">
```

2. **Stop floating the CDN tag** — import the already-installed, pinned package instead of `@latest`, so a future release cannot silently break the shell again:

```css
@import '@tabler/core/dist/css/tabler.min.css';
@import '@tabler/core/dist/css/tabler-vendors.min.css';
```

(or vendor the CSS via `apps/web/package.json` / `next.config`, and load `tabler.min.js` the same way rather than from the CDN `<script>` in `layout.tsx`).

**Interim demo mitigation (no code change):** drive the demo by URL (`/dashboard`, `/memberships`, …) and use the **top-right user menu** for Settings and Sign out — verified reachable and functional (see F3).

### F2 — LOW · Memberships table shows raw UUIDs instead of names (demo UX)

`apps/web/src/app/memberships/page.tsx` renders identifiers rather than human-readable values:

```tsx
<Th>Member ID</Th> <Th>Plan ID</Th> … <Th>Branch ID</Th>
<Td …>{m.member_id}</Td> <Td …>{m.plan_id ?? '—'}</Td> … <Td …>{m.branch_id ?? '—'}</Td>
```

Observed rendered first row for the demo tenant:

`["ce7f27f4-56e2-425b-8742-dd3a2ecaa337", "96a0bf86-bf90-43af-9ba7-a07e865794ac", "cancelled", "2026-09-14", "2026-10-14", "—", "View"]`

The `useMembers` and `useMembershipPlans` hooks are already imported on this page (used by the create form), so member name / plan name are a lookup away. For a demo-facing screen, UUIDs make it hard for an audience to connect a row to a person or a plan.

**Recommendation:** resolve `member_id` → member name and `plan_id` → plan name for display (fall back to the UUID), keeping the IDs as tooltips/secondary text. Non-functional; does not affect API correctness.

### F3 — LOW · Verification harness defects (not product defects)

Both reported failures are instrumentation errors, now explained:

**Check 25 (sign out).** The script used `page.waitForSelector('.navbar')`, which resolves to **2 elements** (the `<aside>` sidebar and the `<header>` navbar). Playwright picked the first — the `<aside>` — which is `display:none` (F1) and therefore never "visible":

```
waiting for locator('.navbar') to be visible
  63 × locator resolved to 2 elements. Proceeding with the first one:
  <aside data-bs-theme="dark" class="navbar navbar-vertical navbar-expand-lg">…</aside>
TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
```

The script then used `[aria-label="Open user menu"]).first()`, which is the **same duplicate-attribute trap**: both `Sidebar.tsx` (footer, `<div class="navbar-footer">`) and `Navbar.tsx` (`NavbarUserDropdown`) hard-code `aria-label="Open user menu"`, and `.first()` selects the hidden sidebar one.

**Sign-out itself is verified working** when driven through the visible top-navbar menu:

| Step | Result |
|---|---|
| Top navbar user menu (`a.nav-link[aria-label="Open user menu"]`) visibility | `true`, box `[1076, 8, 173, 40]` |
| Menu open → items | `["Settings", "Sign out"]` |
| Click "Sign out" | → `http://localhost:3001/login` |
| `localStorage` after sign-out | keys `[]` — tokens cleared |

(At `/settings` and `/dashboard` alike; the sidebar copy was `isVisible=false` in both cases — F1 again.)



**Check 23 (switch back to Org A).** The assertion looked for human-readable names:

```js
const restored = body2.includes('Browser Gate Plan') || (body2.match(/Jane Updated|Jane Doe/g) || []).length > 0;
```

but the table only ever renders UUIDs (F2), so the assertion **cannot** pass regardless of tenant state. A dedicated re-check proved the **product behaviour is correct**:

| Evidence after switching Org A → isolation org → Org A | Value |
|---|---|
| `localStorage['gym.organizationId']` | `9fb65b8b-f9f8-48ef-a09d-e38a7d8deb0c` (Org A restored) |
| `GET /v1/memberships?page=1&limit=20` | **200** |
| Rendered table rows | **12** (empty-state absent) |
| First row | UUIDs + `cancelled` + `2026-09-14` / `2026-10-14` |

The switch back to Org A **did** restore the tenant and reload the scoped list.

**Recommendation:** make the harness robust — scope selectors to the visible container (e.g. `header.navbar [aria-label="Open user menu"]`), and assert against `gym.organizationId` + row count instead of display copy. Also give the two dropdown triggers distinct accessible names in the product code, since duplicate `aria-label`s are a genuine accessibility smell.

---

## 5. Confirmations (no defect found)

- **Cross-tenant isolation:** foreign-tenant membership read returned **403** and rendered **no** Org A data; the tenant id is derived server-side from the token, never trusted from the client.
- **Lifecycle correctness:** all five transitions (pause → resume → freeze → unfreeze → cancel) returned the expected status and persisted.
- **AI contracts:** retention-analysis and plan-performance both returned `200` with `organization_id` matching the active tenant; usage limits surfaced correctly (`20 req/min`, `200k tokens/day`, `$25/month`).
- **Build provenance:** the running artifact was confirmed to match workspace sources by SHA256 fingerprint.
- **Runtime hygiene:** **0 console errors, 0 page errors** across every page visited in every run.
- **Auth gating:** unauthenticated `/memberships` redirects to `/login`; bad credentials yield `401` + `"Invalid credentials"`.

---

## 6. Working-tree state at report time

`git status --porcelain` shows **115 entries**, all Phase 2A/2B/2C work plus this report; **no application source was changed by this validation task**. Untracked (non-`dist/`) highlights: `src/ai/`, `src/memberships/`, `src/migrations/1788965263228…1788965263232*`, `apps/web/src/app/{memberships,membership-plans,retention-analysis,plan-performance,ai-usage}/`, `apps/web/src/components/ai/`, `apps/web/src/lib/{ai-api,ai-errors,memberships-api}.ts`, `scripts/`, plus `PHASE_2B_AI_RETENTION_VERIFICATION_REPORT.md` and this report.

All temporary verification scripts lived under `/tmp` (`/tmp/pw_*.cjs`) and were never added to the repository.

---

## 7. Verdict and recommendation

**Phase 2 demo flow: FUNCTIONALLY VERIFIED — 23/25 browser checks (2 false negatives proven), 439/439 tests, both typechecks clean, 0 console/page errors.**

**Blocking issue for a live demo: F1** (invisible sidebar → no in-app navigation). It is a one-attribute markup fix plus a CDN pinning change, both low-risk and well isolated; with them applied the full demo script runs end-to-end from the UI as intended.

**Priority order**

1. **F1 markup** — add `data-bs-navbar-position="vertical"` to `<html>` in `apps/web/src/app/layout.tsx`.
2. **F1 pinning** — replace the `@latest` CDN `@import`/`<script>` with the pinned `@tabler/core` 1.5.1 dependency so the shell cannot break again without a commit.
3. **F2** — display member/plan names in the Memberships table (demo polish).
4. **F3** — harden the harness selectors and give the two user-menu triggers distinct accessible names.
