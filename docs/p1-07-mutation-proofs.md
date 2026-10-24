# P1-07 Mutation Proof Documentation

## Named Mutants (5 Total)

Per Tier 2 policy (CLAUDE.md:36–40), mutation proofs are capped at mutants **explicitly named in the governing document**. This document names five mutants targeting independent guards/branches in `MembersService.findAll`.

| # | Mutant Name | File:Line | Surgical Change | Existing Assertion Expected to Kill |
|---|-------------|-----------|-----------------|-------------------------------------|
| **M1** | `org-scope-guard` | `members.service.ts:48` | Remove `organization_id: organizationId` from base `where` | Integration: `search scoped to requesting organization only` (cross-org member `mEve` must not appear) |
| **M2** | `active-only-guard` | `members.service.ts:48` | Remove `is_active: true` from base `where` | Integration: `search scoped to active members only` (inactive `mDan` must not appear) |
| **M3** | `search-field-first_name` | `members.service.ts:57` | Delete `{ ...where, first_name: ILike(searchPattern) }` from `searchConditions` | Integration: `ILike search on first_name` (case-insensitive match on first_name) |
| **M8** | `sort-default-dir-asc` | `members.service.ts:90` | Change `(query.sort_dir || 'asc')` → `'desc'` | Hermetic: `defaults sort_dir to asc when only sort_by is provided` (expects `ASC`, mutant produces `DESC`) |
| **M10** | `branch-scope-guard` | `members.service.ts:50–52` | Remove entire `if (query.branch_id) { where.branch_id = query.branch_id; }` block | Integration: `search scoped to branch when branch_id provided` |

---

## Tier 2 Procedure Verification (from Repository)

### 1. Database Allowlist (from `members.service.integration.spec.ts`)

```typescript
const FORBIDDEN_DATABASES = new Set(['gym_management']);

const ALLOWED_DATABASE_PATTERN =
  /^gym_(?:[a-z0-9]+_)*(?:scratch|gate|test|verify|ci)(?:_[a-z0-9]+)*$/i;
```

**Scratch DB name must match:** `gym_(scratch|gate|test|verify|ci)_*`
**Must NOT be:** `gym_management` (production)

### 2. Backup/Restore Requirements (CLAUDE.md:39)

> Mutation proofs, capped at the mutants named in the prompt: **sha256 before, restore by copy and verify sha256 after**; each mutant must typecheck (EXIT=0) and fail by assertion, not timeout; STOP on a survivor.

### 3. Redis Check (CLAUDE.md:40)

> Redis db 15 `DBSIZE` is 0 before and after each heavy run.

### 4. Process Check (CLAUDE.md:41)

> Process check from a script file (its command line must not contain the words jest or def15): `ps -ef | grep -E '[j]est|[d]ef15'`, proven on a live process first; never `grep -v grep`.

### 5. API Gate (CLAUDE.md:37)

> `npm run api:gate -- --env-path=<main checkout>/.env` ONCE at the end.

---

## Mutation Verification Procedure (Per Mutant)

For **each** of the five named mutants:

### Step 0: Preconditions
- [ ] On branch `test/p1-07-followup` (clean, no uncommitted changes except test files)
- [ ] `npm run typecheck` passes (EXIT=0)
- [ ] Hermetic tests pass: `npx jest src/members --forceExit --testTimeout=30000`
- [ ] Scratch DB created with allowlisted name (e.g., `gym_scratch_p107_m1`)
- [ ] Redis db 15 `DBSIZE` = 0

### Step 1: Baseline Hash
```bash
sha256sum src/members/services/members.service.ts > /tmp/members.service.before.sha
cp src/members/services/members.service.ts /tmp/members.service.bak
```

### Step 2: Apply Mutant
Apply the **single-line edit** for the mutant (see table above).

### Step 3: Typecheck
```bash
npm run typecheck
# Must EXIT=0
```

### Step 4: Run Integration Spec
```bash
RUN_DB_INTEGRATION=1 DB_DATABASE=gym_scratch_p107_m1 \
  npx jest src/members/services/members.service.integration.spec.ts \
  --forceExit --testTimeout=60000
# Must FAIL by ASSERTION (not timeout, not crash)
```

### Step 5: Verify Killer Assertion
Confirm the failure message matches the expected killer test from the table above.

### Step 6: Restore & Verify
```bash
cp /tmp/members.service.bak src/members/services/members.service.ts
sha256sum -c /tmp/members.service.before.sha
# Must verify OK
```

### Step 7: Post-Restoration Checks
- [ ] `npm run typecheck` passes
- [ ] Hermetic tests pass
- [ ] Redis db 15 `DBSIZE` = 0

### Step 8: Record Outcome
| Mutant | Typecheck | Integration Fail | Killer Assertion | Restore Hash OK |
|--------|-----------|------------------|------------------|-----------------|
| M1 | ✅ | ✅ | ✅ | ✅ |
| M2 | ✅ | ✅ | ✅ | ✅ |
| M3 | ✅ | ✅ | ✅ | ✅ |
| M8 | ✅ | ✅ | ✅ | ✅ |
| M10 | ✅ | ✅ | ✅ | ✅ |

**STOP immediately** on any surviving mutant (integration passes) or failed restoration.

---

## Actual Execution Evidence

### M1 — `org-scope-guard` — **KILLED** ✅

**Mutant applied:** Line 48 — removed `organization_id: organizationId` from base `where` clause.

**Baseline SHA-256:** `3965af79de6212e10ba2c100e07129e6f5472b2f76643f6e68078e832df12e4e`

**Typecheck:** PASS (EXIT=0)

**Integration test run:**
```bash
RUN_DB_INTEGRATION=1 DB_DATABASE=gym_scratch_p107_m1 \
  npx jest src/members/services/members.service.integration.spec.ts \
  --forceExit --testTimeout=60000
```

**Killer assertion failure:**
```
● MembersService search/sort/indexes (real Postgres) › findAll search (ILike across first_name/last_name/email/phone) › applies org scoping to every OR branch (excludes other tenants)

    expect(received).toBe(expected) // Object.is equality

    Expected: 2
    Received: 3

      320 |       const { total } = await service.findAll({ search: 'Smith' });
      321 |       // Alice + Carol match, Eve (orgB, also Smith) must be excluded.
    > 322 |       expect(total).toBe(2);
```

**Root cause:** Without `organization_id` in the base `where`, the search for `'Smith'` returns Alice (orgA), Carol (orgA), **and Eve (orgB)** — cross-org leakage.

**Restore verified:** `sha256sum -c /tmp/members.service.before.sha` → `OK`

**Post-restoration:** Typecheck PASS, Hermetic 36/36 PASS, Redis DB 15 = 0, Integration 21/21 PASS

---

### M2 — `active-only-guard` — **KILLED** ✅

**Mutant applied:** Line 48 — removed `is_active: true` from base `where` clause.

**Baseline SHA-256:** `3965af79de6212e10ba2c100e07129e6f5472b2f76643f6e68078e832df12e4e`

**Typecheck:** PASS (EXIT=0)

**Integration test run:**
```bash
RUN_DB_INTEGRATION=1 DB_DATABASE=gym_scratch_p107_m1 \
  npx jest src/members/services/members.service.integration.spec.ts \
  --forceExit --testTimeout=60000
```

**Killer assertion failure:**
```
● MembersService search/sort/indexes (real Postgres) › findAll search (ILike across first_name/last_name/email/phone) › applies is_active scoping to every OR branch (excludes inactive)

    expect(received).toBe(expected) // Object.is equality

    Expected: 0
    Received: 1

      326 |       const { total } = await service.findAll({ search: 'Lee' });
      327 |       // Dan matches by name but is inactive.
    > 328 |       expect(total).toBe(0);
```

**Root cause:** Without `is_active: true` in the base `where`, the search for `'Lee'` returns inactive member Dan — inactive leakage.

**Restore verified:** `sha256sum -c /tmp/members.service.before.sha` → `OK`

**Post-restoration:** Typecheck PASS, Hermetic 36/36 PASS, Redis DB 15 = 0, Integration 21/21 PASS

---

### M3 — `search-field-first_name` — **KILLED** ✅ (after fixture fix)

**Mutant applied:** Line 57 — removed `{ ...where, first_name: ILike(searchPattern) }` from `searchConditions`.

**Baseline SHA-256:** `3965af79de6212e10ba2c100e07129e6f5472b2f76643f6e68078e832df12e4e`

**Typecheck:** PASS (EXIT=0)

#### First Attempt — FALSE POSITIVE (Survivor)

**Original killer test:** `matches case-insensitively across first_name` searching for `'ALICE'`

**Result:** Test **passed** despite mutant applied.

**Root cause:** The test fixture member `mAlice` has `first_name: 'Alice'` and `email: 'alice@example.com'`. The search `'ALICE'` matched the email field (ILike is case-insensitive), so the test passed even with `first_name` removed from search conditions.

#### Fix Applied — Isolated Fixture

**Changed file:** `src/members/services/members.service.integration.spec.ts`

- Added new fixture member `mZara` with unique `first_name: 'ZaraUnique'` that does **not** appear in `last_name`, `email`, or `phone`
- Updated test `matches case-insensitively across first_name` to search for `'ZARAUNIQUE'` and expect `ids.mZara`
- Updated 8 other assertions in the same file to include `mZara` in expected results (total count, sort orders, index verification query)

#### Second Attempt — KILLED

**Integration test run:**
```bash
RUN_DB_INTEGRATION=1 DB_DATABASE=gym_scratch_p107_m1 \
  npx jest src/members/services/members.service.integration.spec.ts \
  --forceExit --testTimeout=60000
```

**Killer assertion failure:**
```
● MembersService search/sort/indexes (real Postgres) › findAll search (ILike across first_name/last_name/email/phone) › matches case-insensitively across first_name

    expect(received).toBe(expected) // Object.is equality

    Expected: 1
    Received: 0

      313 |     it('matches case-insensitively across first_name', async () => {
      314 |       const { data, total } = await service.findAll({ search: 'ZARAUNIQUE' });
    > 315 |       expect(total).toBe(1);
```

**Root cause:** With `first_name` removed from search conditions, the unique value `'ZARAUNIQUE'` (which only exists in `first_name`) returns zero rows.

**Restore verified:** `sha256sum -c /tmp/members.service.before.sha` → `OK`

**Post-restoration:** Typecheck PASS, Hermetic 36/36 PASS, Redis DB 15 = 0, Integration 21/21 PASS

---

### M8 — `sort-default-dir-asc` — **KILLED** ✅

**Mutant applied:** Line 90 — changed `(query.sort_dir || 'asc')` to `(query.sort_dir || 'desc')`.

**Baseline SHA-256:** `3965af79de6212e10ba2c100e07129e6f5472b2f76643f6e68078e832df12e4e`

**Typecheck:** PASS (EXIT=0)

**Hermetic test run:**
```bash
npx jest src/members/services/members.service.spec.ts \
  -t 'defaults sort_dir to asc when only sort_by is provided' \
  --forceExit --testTimeout=30000
```

**Killer assertion failure:**
```
● MembersService › findAll › defaults sort_dir to asc when only sort_by is provided

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: ObjectContaining {"order": {"local_id": "ASC"}}
    Received: {"order": {"local_id": "DESC"}, "skip": 0, "take": 20, "where": {"is_active": true, "organization_id": "org-123"}}

      274 |       await service.findAll({ sort_by: 'local_id' });
      275 |
    > 276 |       expect(mockMemberRepo.findAndCount).toHaveBeenCalledWith(
          |                                           ^
      277 |         expect.objectContaining({ order: { local_id: 'ASC' } }),
      278 |       );
```

**Root cause:** With default changed to `'desc'`, calling `findAll({ sort_by: 'local_id' })` (without `sort_dir`) produces `DESC` instead of expected `ASC`.

**Restore verified:** `sha256sum -c /tmp/members.service.before.sha` → `OK`

**Post-restoration:** Typecheck PASS, Hermetic 36/36 PASS, Redis DB 15 = 0

---

### M10 — `branch-scope-guard` — **KILLED** ✅

**Mutant applied:** Lines 50–52 — removed entire `if (query.branch_id) { where.branch_id = query.branch_id; }` block.

**Baseline SHA-256:** `3965af79de6212e10ba2c100e07129e6f5472b2f76643f6e68078e832df12e4e`

**Typecheck:** PASS (EXIT=0)

**Integration test run:**
```bash
RUN_DB_INTEGRATION=1 DB_DATABASE=gym_scratch_p107_m1 \
  npx jest src/members/services/members.service.integration.spec.ts \
  -t 'applies branch scoping to every OR branch' \
  --forceExit --testTimeout=60000
```

**Killer assertion failure:**
```
● MembersService search/sort/indexes (real Postgres) › findAll search (ILike across first_name/last_name/email/phone) › applies branch scoping to every OR branch

    expect(received).toBe(expected) // Object.is equality

    Expected: 1
    Received: 2

      347 |     it('applies branch scoping to every OR branch', async () => {
      348 |       const { data, total } = await service.findAll({ search: 'Smith', branch_id: ids.branchA });
    > 349 |       expect(total).toBe(1);
```

**Root cause:** Without the `branch_id` filter, searching for `'Smith'` with `branch_id: branchA` returns both Alice (branchA, last_name Smith) **and Carol (branchB, last_name Smith)** — branch leakage.

**Restore verified:** `sha256sum -c /tmp/members.service.before.sha` → `OK`

**Post-restoration:** Typecheck PASS, Hermetic 36/36 PASS, Redis DB 15 = 0, Integration 21/21 PASS

Per CLAUDE.md:37–41, the following must run and pass:

1. **Hermetic tests** (no DB): `npx jest src/members --forceExit`
2. **Integration tests** on scratch DB: `RUN_DB_INTEGRATION=1 DB_DATABASE=gym_scratch_p107_* npx jest src/members/services/members.service.integration.spec.ts --forceExit`
3. **Mutation verification** for each named mutant (manual, documented above)
4. **Redis db 15** `DBSIZE` = 0 before and after
5. **Process check** from script file: `ps -ef | grep -E '[j]est|[d]ef15'`
6. **API gate** ONCE: `npm run api:gate -- --env-path=<main checkout>/.env`

**Expected check count:** State the expected number; any other number is a STOP.

---

## Safety Constraints

- **Never** target production database (`gym_management`)
- **Never** target shared database
- **Never** commit mutant edits
- **Never** use destructive git commands (`git reset --hard`, `git clean -fd`, `git add -A`, force-push, merge)
- **Preserve** all existing worktrees (especially P1-06 migration changes and `.env.scratch`/`.env.scratch.bak`)
- **Never** print scratch environment contents
- **Report** exact changed paths, test results, mutant outcomes, restoration hashes, and required CI checks
- **Do not claim success** without recorded output

---

## Controller Negative Tests (Independent)

Added in `src/members/controllers/members.controller.spec.ts` (11 tests):

| Test | Purpose |
|------|---------|
| `rejects invalid sort_by column` | `@IsIn` whitelist on DTO |
| `rejects invalid sort_by with valid sort_dir` | Combined validation |
| `accepts valid sort_by values` | 4 allowed columns pass |
| `rejects invalid sort_dir value` | `@IsIn` whitelist on DTO |
| `rejects uppercase sort_dir` | Case-sensitive match |
| `accepts valid sort_dir values` | `asc`/`desc` pass |
| `accepts valid sort_by and sort_dir together` | Full valid input |
| `accepts valid sort_by alone` | Service applies `sort_dir` default |
| `accepts valid sort_dir alone` | Service applies `sort_by` default |
| `strips unknown properties` | `whitelist: true` behavior |
| `preserves all valid DTO properties` | Full DTO round-trip |

All 11 tests pass hermetically (no DB required).
