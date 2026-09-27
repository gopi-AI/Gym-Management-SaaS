import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyRule } from '../entities/loyalty-rule.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyAccrualService } from './loyalty-accrual.service';
import { LoyaltyExpiryService } from './loyalty-expiry.service';

/**
 * DB-backed regression test for BOTH `LOYALTY_TRANSACTIONS` writers.
 *
 * **Why this exists.** 1788965263403-AddOrganizationIdToLoyaltyTransactions.ts
 * added `organization_id` as `NOT NULL` with no DEFAULT, but neither writer set
 * it — so every accrual insert and every expiry-sweep insert started failing with
 * `null value in column "organization_id" ... violates not-null constraint`. That
 * migration's own verification missed it because the write path was probed with a
 * **hand-written INSERT shaped by the author**, not by driving the service: the
 * synthetic statement simply omitted the new column and so never failed the way
 * the real code does. This test drives the real methods — `handleCheckIn()` and
 * `sweepExpiredTransactions()` — against a real, migrated schema, which is the
 * only form of check that would have caught it.
 *
 * **When it runs.** It reads the same `DB_*` environment variables as the TypeORM
 * CLI (`src/data-source.ts`) and runs whenever `DB_HOST` is set. CI
 * (`.github/workflows/ci.yml`) provisions a `postgres:16-alpine` service and sets
 * those variables job-wide, so this suite executes there; with no `DB_*` variables
 * it skips rather than erroring, which is what keeps a local `npm test` without
 * Postgres passing:
 *
 *   npm test -- loyalty-writers                     # no DB configured -> skipped
 *   DB_HOST=127.0.0.1 DB_PORT=5432 DB_USERNAME=postgres \
 *     DB_PASSWORD=... DB_DATABASE=<migrated-db> npm test -- loyalty-writers
 *
 * The target database must be migrated already, or be migratable by
 * `runMigrations()` below. Everything it writes is keyed to a per-run random
 * organization id and removed in `afterAll`.
 */
const ENABLED = Boolean(process.env.DB_HOST);
const describeDb = ENABLED ? describe : describe.skip;

describeDb('LOYALTY_TRANSACTIONS writers satisfy the NOT NULL organization_id column', () => {
  let ds: DataSource;
  let accrual: LoyaltyAccrualService;
  let expiry: LoyaltyExpiryService;

  const orgId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const secondMemberId = crypto.randomUUID();

  beforeAll(async () => {
    ds = AppDataSource;
    try {
      await ds.initialize();
      await ds.runMigrations();
    } catch (error) {
      throw new Error(
        `Could not reach a migrated database (${process.env.DB_DATABASE ?? 'gym_management'}) ` +
          `at ${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '5432'}. ` +
          `Set the DB_* variables, create the database, and run ` +
          `"CREATE EXTENSION IF NOT EXISTS \\"uuid-ossp\\";" plus "npm run migration:run" first. ` +
          `Cause: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Precondition: without the column this test proves nothing, so fail loudly
    // rather than passing vacuously.
    const [{ count }]: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM information_schema.columns ` +
        `WHERE table_name = 'LOYALTY_TRANSACTIONS' AND column_name = 'organization_id'`,
    );
    if (count !== 1) {
      throw new Error(
        'LOYALTY_TRANSACTIONS.organization_id is missing — run `npm run migration:run` first.',
      );
    }

    const outbox = new OutboxService(ds.getRepository(OutboxEntity));
    accrual = new LoyaltyAccrualService(
      ds.getRepository(LoyaltyAccount),
      ds.getRepository(LoyaltyTransaction),
      ds.getRepository(LoyaltyRule),
      ds.getRepository(Organization),
      ds,
      outbox,
    );
    expiry = new LoyaltyExpiryService(
      ds.getRepository(LoyaltyTransaction),
      ds.getRepository(LoyaltyAccount),
      outbox,
    );

    await ds.getRepository(Organization).save({
      id: orgId,
      name: 'loyalty-writers-test',
      timezone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
    });
    await ds.getRepository(LoyaltyRule).save({
      organization_id: orgId,
      name: 'writers test check-in rule',
      trigger_event: 'check_in',
      points_per_event: 10,
      max_per_day: 5,
      is_active: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    // Scoped by this run's random org id, plus the outbox envelopes that name it.
    await ds.query(`DELETE FROM "LOYALTY_TRANSACTIONS" WHERE organization_id = $1`, [orgId]);
    await ds.query(`DELETE FROM "LOYALTY_ACCOUNTS" WHERE organization_id = $1`, [orgId]);
    await ds.query(`DELETE FROM "LOYALTY_RULES" WHERE organization_id = $1`, [orgId]);
    await ds.query(`DELETE FROM "shared"."outbox" WHERE payload LIKE '%' || $1 || '%'`, [orgId]);
    await ds.getRepository(Organization).delete({ id: orgId });
    await ds.destroy();
  });

  it('LoyaltyAccrualService persists organization_id on the earn row (handleCheckIn)', async () => {
    const referenceId = `writers-test-${crypto.randomUUID()}`;

    const result = await accrual.handleCheckIn({
      organizationId: orgId,
      memberId,
      eventType: 'CHECK_IN',
      eventId: referenceId,
      eventTime: new Date().toISOString(),
    });

    // Pre-fix, awardForTrigger's catch turns the NOT NULL violation into
    // `awarded: false` — so surface the service's own reason rather than letting
    // this read as an opaque assertion failure.
    if (!result.awarded) {
      throw new Error(`accrual did not award, so the insert failed: ${result.reason}`);
    }

    const rows = await ds
      .getRepository(LoyaltyTransaction)
      .find({ where: { reference_id: referenceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(orgId);
  });

  it('LoyaltyExpiryService persists organization_id on the expire row', async () => {
    const account = await ds.getRepository(LoyaltyAccount).save({
      organization_id: orgId,
      member_id: secondMemberId,
      balance: 30,
      lifetime_points_earned: 30,
    });

    // An already-expired earn row. This fixture supplies organization_id itself:
    // the writer under test is the expiry sweep, not the fixture.
    const earn = await ds.getRepository(LoyaltyTransaction).save({
      account_id: account.id,
      organization_id: orgId,
      transaction_type: 'earn',
      points: 30,
      remaining_points: 30,
      reference_type: 'check_in',
      description: 'expiry-sweep fixture',
      expires_at: new Date(Date.now() - 86_400_000),
    });

    const processed = await expiry.sweepExpiredTransactions(50);

    // The sweep swallows per-row failures and counts successes, so pre-fix the
    // observable behaviour is `processed === 0`, not a thrown error.
    if (processed < 1) {
      throw new Error(
        'expiry sweep processed 0 rows — the expire insert most likely violated NOT NULL',
      );
    }

    const expireRows = await ds
      .getRepository(LoyaltyTransaction)
      .find({ where: { account_id: account.id, transaction_type: 'expire' } });
    expect(expireRows.length).toBeGreaterThanOrEqual(1);
    expect(expireRows.every((row) => row.organization_id === orgId)).toBe(true);

    // The sweep's own bookkeeping still holds.
    const swept = await ds
      .getRepository(LoyaltyTransaction)
      .findOneOrFail({ where: { id: earn.id } });
    expect(swept.remaining_points).toBe(0);
  });

});

