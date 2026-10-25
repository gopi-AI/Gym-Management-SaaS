# P1-06 Branch-Settings Schema Drift — Corrected Report

**Date:** 2026-10-25
**Scope:** the local development container `gym-postgres` (`127.0.0.1:5433`) and the disposable test container `gym-disposable-test` (`127.0.0.1:5434`)
**Status:** corrected re-measurement. This report supersedes the 2026-10-25 audit that reported every `TENANCY_BRANCH_SETTINGS` table empty. That report's central data claim is wrong; this report re-measures every database and records the correction.

## 1. What actually happened to the dev rows

The earlier audit reported `gym_management` as "Table Exists: No" and every `TENANCY_BRANCH_SETTINGS` table as empty. Direct re-measurement contradicts that:

| Checkpoint | `gym_management` settings rows | history rows | duplicate groups |
|---|---:|---:|---:|
| First investigation, 2026-10-25 03:27 IST | 6 | 15 | 1 group of 3 rows |
| This re-measurement, 2026-10-25 20:20 IST | 6 | 15 | same 3 rows |

The three rows in the duplicate group are the same rows, by primary key:
`3be461ac-b409-42a5-ba23-189d40f388f2`,
`a210b774-2263-4e57-890c-5552ad99f178`, and
`ea0bf7fe-c02a-4f7d-b588-2865eef4c95e` — all on
`(branch_id, organization_id) = (4b0072c8-0378-4364-b54b-1a73610509e9, 29614246-1fc2-47ca-91c3-c84620f61d5c)`.
Their `created_at` / `updated_at` values are 2026-10-19 09:48:16 UTC in both readings. The history table still holds 15 rows spanning 2026-10-19 09:48:16 UTC to 2026-10-22 07:32:43 UTC.

Why this is the same data and not a recreation:

- The `gym-postgres` container was created 2026-09-13 23:48:53 IST and has not been recreated.
- `gym_management` is database OID 16384. The heap files for the two tables are `base/16384/409257` and `base/16384/409266`; their filesystem mtimes are 2026-10-22 07:35:55 UTC and 2026-10-22 12:06:05 UTC — both before the earlier audit (2026-10-25 19:18–19:35 IST) and unchanged since.
- The earlier audit's report was written at 2026-10-25 19:35:49 IST (14:05:49 UTC), after both file mtimes. It did not write to these tables.

**Conclusion:** no rows were deleted, truncated, or rewritten. The earlier audit's "all tables empty / no table in `gym_management`" result is a measurement or labelling error, not a data-loss event. Its conclusion that "the six duplicate rows do not exist" is also false: the duplicate group is present and unchanged.

What did run against 5433? The audit's report covers 5433 databases, and its queries produced the `relation "tenancy_branch_settings" does not exist` errors visible in the Postgres log for databases that do not have the table. The log prefix does not name the database, so attributing each individual error is INFERRED rather than measured. There is no evidence that the fixed draft or any destructive statement ran against `gym_management`: the table has no `UQ_branch_settings_branch_org` constraint, no branch-settings permission rows, and no branch-settings migration records, and the log shows no `could not create unique index` or `duplicate key` error in the last 12 hours. If the draft was attempted there, it failed and rolled back; either way the rows are unchanged.

Further corrections to the earlier report's data table:

- `gym_management` has both `TENANCY_BRANCH_SETTINGS` and `TENANCY_BRANCH_SETTINGS_HISTORY`; it is not pre-migration.
- `gym_management_branch_settings_test` also has the settings table (0 rows), not "Table Exists: No". It has no `typeorm_migrations` table at all.
- `gym_migration_test` on port 5434 has **no** settings table; the earlier report recorded it as existing with 0 rows.

## 2. Measured drift matrix

### 5433 (`gym-postgres`)

| Database | Branch-settings migration records | Settings rows | History rows | Duplicate groups | Index on `(branch_id, organization_id)` | UQ constraint | Branch-settings permissions | Classification |
|---|---|---:|---:|---:|---|---|---:|---|
| `gym_management` | 0 | 6 | 15 | 1 (3-row group) | `IDX_branch_settings_branch_org` — **non-unique** | none | 0 | Hand-provisioned dev schema, outside migration history |
| `gym_management_branch_settings_test` | no `typeorm_migrations` table | 0 | 0 | 0 | `IDX_branch_settings_branch_org` — non-unique | none | no `IDENTITY_PERMISSIONS` table | Legacy scratch schema, outside migration history |
| `gym_branch_settings_scratch` | 4 (`1252`, `1253`, `1254`, draft `1255`) | 0 | 2 | 0 | `IDX_...` — unique | `UQ_...` | 2 | Type A (draft drift) |
| `gym_scratch_p106` | 4 (`1252`, `1253`, `1254`, draft `1255`) | 0 | 4 | 0 | `IDX_...` — unique | `UQ_...` | 2 | Type A (draft drift) |
| `gym_scratch_p107_m1` | 4 (`1252`, `1253`, `1254`, draft `1255`) | 0 | 0 | 0 | `IDX_...` — unique | `UQ_...` | 2 | Type A (draft drift) |
| `gym_scratch_p107_tier2` | 3 (three `1252` entries) | 0 | 0 | 0 | `IDX_...` — unique | none | 2 | Type B (no draft `1255`) |
| `def15_gate` | no `typeorm_migrations` table | no table | — | — | — | — | — | No branch-settings table |
| `gym_gate_1f9d5145`, `gym_gate_34dba101`, `gym_gate_69c820d7` | 0 | no table | — | — | — | — | — | No branch-settings table (pre-existing gate databases) |
| `gym_hardening_atomicity`, `gym_hardening_migration` | 0 | no table | — | — | — | — | — | No branch-settings table |
| `gym_item1_verify_1791230232` | 0 | no table | — | — | — | — | — | No branch-settings table |
| `gym_p6_final`, `gym_p6_merge_verify`, `gym_p6_merge_zero`, `gym_p6_merge_zero_v3` | 0 | no table | — | — | — | — | — | No branch-settings table |
| `p305_migration_validation_1790154127`, `p312_final_1790250345` | 0 | no table | — | — | — | — | — | No branch-settings table |

The dev schema is **not migration-managed**: it has a settings table with a non-unique index and 6 rows including one 3-row duplicate group, no UQ, no branch-settings permissions, and no branch-settings migration records. `synchronize` is hard-disabled in this repository, so the table was created by direct SQL / manual provisioning, not by TypeORM.

The Type A databases record `CreateBranchSettingsHistoryTable1792402551253` and `ProvisionBranchSettingsPermissions1792402551254`. Those class names exist only in the unmerged local working tree (the local 1253/1254 files are pure renames of the shipped 1252 files). They are scratch databases built from that tree; the renumbering is not part of this PR and does not exist on `main`.

### 5434 (`gym-disposable-test`)

Eight `gym_migration_test*` databases:

- `gym_migration_test`, `gym_migration_test_v7`: no settings table.
- `gym_migration_test_v2`, `_v3`, `_v8`: 0 settings rows, settings and history tables exist, only `PK_branch_settings` and `UQ_branch_settings_branch_org` — **no `IDX_branch_settings_branch_org` at all**.
- `gym_migration_test_v4`, `_v5`, `_v6`: 0 settings rows, settings table exists, no history table, only `PK_branch_settings` and `UQ_branch_settings_branch_org`.

These are disposable test databases, not deployment environments; this PR does not touch them. The v2–v8 shape is the "UQ exists, canonical index missing" edge case: the new migration refuses to drop the UQ there because that would remove the only uniqueness guard.

## 3. Canonical object decision — option (a)

**Decision:** `IDX_branch_settings_branch_org`, the unique index created by merged migration `1792402551252`, is canonical. The reconciliation drops `UQ_branch_settings_branch_org` where the unmerged draft created it.

Reasons:

1. Migration 1252 is merged and immutable and creates `CREATE UNIQUE INDEX "IDX_branch_settings_branch_org"`. No shipped migration ever creates `UQ_branch_settings_branch_org`; that name exists only in the unmerged local draft.
2. Nothing in the codebase references `UQ_branch_settings_branch_org` by name. `BranchSettingsService.update` resolves the previous row with an application-level `findOne` and carries its id; it does not use `ON CONFLICT`.
3. The branch-settings real-DB integration spec explicitly documents that it verifies the UNIQUE INDEX on `(branch_id, organization_id)`. The index is the object the shipped tests name.
4. Postgres enforces a unique index and a unique constraint equivalently; dropping the constraint keeps the same uniqueness invariant through the index.
5. Option (a) touches only the three local scratch databases that ran the draft and leaves every fresh/shipped environment exactly as 1252 built it. Option (b) would drop a shipped index in every environment and install a constraint with no shipped provenance.

Consequence: the dev database's hand-created index is **non-unique**, so option (a) cannot make that table canonical without deduplicating its 3 duplicate rows. That is a separate owner decision (section 5), not something this migration performs.

## 4. The migration

`src/migrations/1792939267116-DropRedundantBranchSettingsUniqueConstraint.ts`:

- verifies that `IDX_branch_settings_branch_org` exists, is valid, and is unique (catalog query on `pg_index` / `pg_class`);
- if it does not, throws before issuing any DDL — it never removes the last uniqueness guard;
- otherwise runs `ALTER TABLE "TENANCY_BRANCH_SETTINGS" DROP CONSTRAINT IF EXISTS "UQ_branch_settings_branch_org"`;
- `down()` is intentionally empty: re-adding the constraint would restore the drift.

It never creates or drops tables, deletes or updates rows, truncates, or provisions permissions.

Why a new migration identity instead of rewriting `1792402551255-ReconcileBranchSettingsSchema.ts`:

- The three Type A scratch databases already record `ReconcileBranchSettingsSchema1792402551255`. TypeORM matches executed migrations by name/timestamp, so a rewritten 1255 would be skipped there and the UQ would remain.
- The draft also contains `CREATE TABLE IF NOT EXISTS` and permission provisioning (duplicating 1252), and its `down()` drops both tables — including any dev-shaped data. Reusing it would carry those behaviours into the shipped history.
- A new timestamp is the only identity that runs on every database and can be verified independently. The draft is abandoned; it is not part of the PR.

## 5. Dev database disposition

`gym_management` cannot be brought under the branch-settings migrations by this PR:

- It has no branch-settings migration records and already has a settings table. A `migration:run` on a template copy reached `CreateBranchSettingsTable1792402551252` and failed with `relation "TENANCY_BRANCH_SETTINGS" already exists` (after the idempotent permission migration ran). It never reached the new migration.
- Invoking the new migration's `up()` directly on a copy failed closed: `Refusing to drop UQ_branch_settings_branch_org: the canonical unique index IDX_branch_settings_branch_org ... is missing, invalid, or non-unique.` The copy kept 6 settings rows and 15 history rows.
- The 3 duplicate rows are real dev data from 2026-10-19, not transient test rows. Making the index unique would require choosing which row to keep. That is a data decision for the owner, not something a migration may do silently.
- **Recommendation:** leave `gym_management` as it is for this PR. If it needs to become migration-managed, make a separate, explicit decision to deduplicate the 3 rows (or recreate the table) with a backup.

## 6. Verification

### Migration and module specs

- `npx jest src/migrations --runInBand` → `Test Suites: 17 passed, 17 total`; `Tests: 76 passed, 76 total`; `EXIT=0`. This includes the new migration spec and `migration-loader.contract.spec.ts`.
- `npx jest src/tenancy --runInBand` (hermetic) → `Test Suites: 1 skipped, 5 passed, 5 of 6 total`; `Tests: 7 skipped, 37 passed, 44 total`; `EXIT=0`.
- Same directory with `RUN_DB_INTEGRATION=1` against the fresh scratch database → `Test Suites: 6 passed, 6 total`; `Tests: 44 passed, 44 total`; `EXIT=0`.
- Redis db 15 `DBSIZE` was `0` before and `0` after the gated run; db 0 stayed at `6`.

### Real-DB migration scenarios

| Scenario | Scratch database | Result |
|---|---|---|
| Fresh | `gym_p106_reconcile_fresh_1792939267116` | 56 migrations recorded; the new migration ran last; `IDX_...` unique; no UQ; 0 settings rows; 2 branch-settings permissions; `MIGRATE_EXIT=0` |
| Type A, canonical bookkeeping | `gym_p106_reconcile_typea_1792939267116` | after adding `UQ_...` and deleting only the new migration's record, `migration:run` re-ran the new migration; UQ dropped; `IDX_...` unique; 56 records; `MIG2_EXIT=0` |
| Type B, actual copy | `gym_p106_reconcile_typeb_1792939267116` | 55 records before, 56 after; new record written; no UQ; `IDX_...` unique; 0 rows; `TYPEB_MIGRATE_EXIT=0` |
| Type A, actual schema copy | `gym_p106_reconcile_typeacopy_1792939267116` | direct `up()` returned `TYPEACOPY_UP=OK`; UQ dropped; `IDX_...` unique; 0 settings / 4 history rows; original `gym_scratch_p106` fingerprint unchanged |
| Dev schema copy | `gym_p106_reconcile_devcopy_1792939267116` | `migration:run` failed at `CreateBranchSettingsTable1792402551252` (`relation ... already exists`, `DEVCOPY_MIGRATE_EXIT=1`); direct `up()` failed closed (`DEVCOPY_UP_EXIT=3`); 6 settings / 15 history rows remained; no UQ; no new record; original `gym_management` fingerprint unchanged |

Original fingerprints, measured with the same query before and after the copy work:

- `gym_management`: `1aefab6fcef4c09734d49f1c67c8f36f33c9eb28a95a61bac44cc551898e04d7`
- `gym_scratch_p106`: `5064e56e26f6ced8a6ffdf788661c2fbdc3903e71b0fa96b6873e0dd16c392b8`
- `gym_scratch_p107_tier2`: `b0d160654fa2a4970cc7a0fcd40c1fa50b3a36198e7a90fe74b6d15643627d37`

### Repository gates

- `npm run typecheck` → `TYPECHECK_EXIT=0`.
- `npm run lint` → `LINT_EXIT=0`.
- Full hermetic suite: `Test Suites: 11 skipped, 142 passed, 142 of 153 total`; `Tests: 108 skipped, 1548 passed, 1656 total`; `JEST_FULL_EXIT=0` (667 s under load; the known `worker process has failed to exit gracefully` teardown warning is present and is not a failure).
- `api:gate` was run once with the expected count stated in advance as **101** checks: `TOTAL pass 101 fail 0 skip 0`; `RESULT: PASS (0 failed)`; `[api-gate] cleanup: dropped gym_gate_5fb8a9c6`; `API_GATE_EXIT=0`. Redis db 15 was `0` before and after; db 0 stayed at `6`; the only `gym_gate_%` databases left are the three pre-existing foreign ones.

## 7. Limitations and open items

- Scope is the two local containers only; there is no access to shared, staging, or production environments.
- The Type A scratch databases' bookkeeping uses the unmerged 1253/1254 names, so `migration:run` cannot reach a later migration there without re-creating them or correcting their records. They are scratch databases; the clean path is to drop and recreate them. The migration's behaviour on their actual schema was verified by executing `up()` on a template copy.
- The dev database's duplicate rows remain (section 5).
- The 5434 `gym_migration_test*` databases are disposable and out of scope.
- The earlier report's "no duplicate data rows" conclusion is withdrawn; the duplicate group is present in `gym_management`.
