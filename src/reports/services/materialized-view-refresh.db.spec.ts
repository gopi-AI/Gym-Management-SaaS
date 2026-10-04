import { randomUUID } from 'node:crypto';
import { createCache, type Cache } from 'cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Member } from '../../members/entities/member.entity';
import { MaterializedView } from '../entities/materialized-view.entity';
import { MaterializedViewRefreshService } from './materialized-view-refresh.service';

jest.setTimeout(120_000);

const ENABLED = Boolean(process.env.DB_HOST);
const describeDb = ENABLED ? describe : describe.skip;

/**
 * A registry `name` that is not a SQL identifier — the hostile row the guard test
 * plants. It is kept in one place so the cleanup below removes exactly the key the
 * test created.
 */
const MALFORMED_VIEW_NAME = 'reports_mv_evil"; DROP TABLE "IDENTITY_USERS';

/** §10's consecutive-failure counter, as `MaterializedViewRefreshService` keys it. */
const FAILURES_KEY = (name: string): string => `reports:mv:refresh:failures:${name}`;

/**
 * Real-PostgreSQL proof of §7.4's refresh flow (P6-15).
 *
 * The unit spec fakes the one thing that cannot be faked honestly — the
 * `REFRESH MATERIALIZED VIEW` statement — so this suite is what makes the claim
 * that the sweep actually refreshes a view true. Like the other DB-backed report
 * suites it runs against the shared `gym_management` database the migrations
 * build, inserting only its own uniquely-keyed rows and removing them afterwards.
 *
 * What is proven here, and could not be proven by a mock:
 *   1. `REFRESH MATERIALIZED VIEW "<name>"` executes against the six real views
 *      the P6-15 migration creates, and the stamp is written back by the repository.
 *   2. A refreshed view is *recomputed*: a row inserted into the base table after
 *      the view was populated appears once the view is refreshed.
 *   3. The §7.3 cadence gate is what stops a second refresh, not the timer.
 *
 * This suite mutates only the reporting registry, one organization's rows and the
 * shared Redis failure counter; everything it writes is removed in `afterAll`. It
 * never drops a database.
 */
describeDb('MaterializedViewRefreshService against PostgreSQL (P6-15)', () => {
  let service: MaterializedViewRefreshService;
  let cache: Cache;
  let store: Awaited<ReturnType<typeof redisStore>>;
  const organizationId = randomUUID();
  const branchId = randomUUID();
  const memberId = randomUUID();
  const registryIds: string[] = [];

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    store = await redisStore({ url: 'redis://127.0.0.1:6379', database: 0 });
    cache = createCache(store);
    // §10's counter is shared Redis state: clear it up front too, so this suite
    // does not depend on a previous run (or an older revision of itself) having
    // cleaned up after itself.
    await cache.del(FAILURES_KEY(MALFORMED_VIEW_NAME));

    service = new MaterializedViewRefreshService(
      AppDataSource.getRepository(MaterializedView),
      AppDataSource as unknown as DataSource,
      cache,
    );

    await AppDataSource.getRepository(Organization).save({
      id: organizationId,
      name: `p6-15-${organizationId}`,
      timezone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
    });
    await AppDataSource.getRepository(Branch).save({
      id: branchId,
      organization_id: organizationId,
      name: 'P6-15',
      address: 'scratch',
      phone: '0',
    });
    await AppDataSource.getRepository(Member).save({
      id: memberId,
      organization_id: organizationId,
      branch_id: branchId,
      global_uuid: randomUUID(),
      local_id: 1,
      first_name: 'P6',
      last_name: 'Fifteen',
      date_of_birth: new Date('1990-01-01'),
      gender: 'unspecified',
    });
  });

  afterAll(async () => {
    if (registryIds.length > 0) {
      await AppDataSource.query(
        'DELETE FROM "REPORTS_MATERIALIZED_VIEWS" WHERE "id" = ANY($1::uuid[])',
        [registryIds],
      );
    }
    // The session row inserted by the recompute test has no FK on `member_id` (only
    // `template_id`/`assignment_id`, both ON DELETE SET NULL), so the Member delete
    // below cannot cascade to it — remove it here or it accumulates in the dev
    // database on every run.
    await AppDataSource.query(
      'DELETE FROM "WORKOUTS_WORKOUT_SESSIONS" WHERE "organization_id" = $1 AND "member_id" = $2',
      [organizationId, memberId],
    );
    await AppDataSource.getRepository(Member).delete({ organization_id: organizationId });
    await AppDataSource.getRepository(Branch).delete({ id: branchId });
    await AppDataSource.getRepository(Organization).delete({ id: organizationId });
    // §10's counter is Redis state, not a row: drop this suite's key so a rerun
    // starts from a clean consecutive-failure count instead of inheriting the
    // previous run's total.
    await cache.del(FAILURES_KEY(MALFORMED_VIEW_NAME));
    await store.client.quit();
    await AppDataSource.destroy();
  });

  /** Reset a view's registry row so the next sweep sees it as never refreshed. */
  const clearStamp = (name: string) =>
    AppDataSource.query(
      'UPDATE "REPORTS_MATERIALIZED_VIEWS" SET "last_refreshed" = NULL WHERE "name" = $1',
      [name],
    );

  const stampOf = async (name: string): Promise<Date | null> => {
    const rows: Array<{ last_refreshed: Date | null }> = await AppDataSource.query(
      'SELECT "last_refreshed" FROM "REPORTS_MATERIALIZED_VIEWS" WHERE "name" = $1',
      [name],
    );
    return rows[0]?.last_refreshed ?? null;
  };

  it('registers the six §7.2 views created by the P6-15 migration', async () => {
    const rows: Array<{ name: string }> = await AppDataSource.query(
      'SELECT "name" FROM "REPORTS_MATERIALIZED_VIEWS" ORDER BY "name"',
    );
    const names = rows.map((row) => row.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'reports_mv_daily_attendance',
        'reports_mv_daily_revenue',
        'reports_mv_membership_summary',
        'reports_mv_daily_workouts',
        'reports_mv_member_churn_monthly',
        'reports_mv_membership_active_monthly',
      ]),
    );
  });

  it('refreshes a real view and stamps last_refreshed', async () => {
    await clearStamp('reports_mv_membership_summary');
    expect(await stampOf('reports_mv_membership_summary')).toBeNull();

    const summary = await service.refreshDue();

    // The sweep covers every registered view; membership_summary is the one whose
    // stamp this test asserts, and it must have refreshed (no prior stamp).
    expect(summary.refreshed).toBeGreaterThan(0);
    expect(await stampOf('reports_mv_membership_summary')).toBeInstanceOf(Date);
  });

  it('recomputes the view when a base row is added after the first refresh', async () => {
    await clearStamp('reports_mv_daily_workouts');
    await service.refreshDue();

    const before: Array<{ session_count: string }> = await AppDataSource.query(
      'SELECT "session_count" FROM "reports_mv_daily_workouts" WHERE "organization_id" = $1 AND "member_id" = $2',
      [organizationId, memberId],
    );
    const baseline = before.reduce((total, row) => total + Number(row.session_count), 0);

    // Insert a real workout session into the base table, then force a refresh by
    // clearing the stamp — which is exactly the state a due cadence produces.
    await AppDataSource.query(
      `INSERT INTO "WORKOUTS_WORKOUT_SESSIONS"
         ("id", "organization_id", "member_id", "session_date", "duration_minutes", "created_at")
       VALUES (gen_random_uuid(), $1, $2, DATE '2026-02-01', 30, now())`,
      [organizationId, memberId],
    );
    await clearStamp('reports_mv_daily_workouts');
    await service.refreshDue();

    const after: Array<{ session_count: string }> = await AppDataSource.query(
      'SELECT "session_count" FROM "reports_mv_daily_workouts" WHERE "organization_id" = $1 AND "member_id" = $2',
      [organizationId, memberId],
    );
    const updated = after.reduce((total, row) => total + Number(row.session_count), 0);

    expect(updated).toBe(baseline + 1);
  });

  it('refreshes a view once by id, and skips it on a sweep inside the cadence window', async () => {
    const row: MaterializedView = await AppDataSource.getRepository(MaterializedView).findOneOrFail({
      where: { name: 'reports_mv_membership_active_monthly' },
    });

    const refreshed = await service.refreshById(row.id);
    expect(refreshed.last_refreshed).toBeInstanceOf(Date);

    // §7.3's cadence gate — not the sweep interval — is what prevents a second refresh.
    const second = await service.refreshDue();
    const skippedNames = second.skipped;
    expect(skippedNames).toBeGreaterThan(0);
    expect(second.scanned).toBeGreaterThanOrEqual(skippedNames);
  });

  it('ignores a deliberately malformed registry name without issuing SQL', async () => {
    const inserted: Array<{ id: string }> = await AppDataSource.query(
      `INSERT INTO "REPORTS_MATERIALIZED_VIEWS" ("name", "description")
       VALUES ($1, 'guard test') RETURNING "id"`,
      [MALFORMED_VIEW_NAME],
    );
    registryIds.push(inserted[0].id);

    const summary = await service.refreshDue();

    expect(summary.failed).toBeGreaterThan(0);
    // The guard refused it before building a statement, so the count advanced by
    // exactly one attempt and the table the injected text named is still there.
    expect(await cache.get<number>(FAILURES_KEY(MALFORMED_VIEW_NAME))).toBe(1);
    const stillExists: Array<{ count: string }> = await AppDataSource.query(
      `SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_name = 'IDENTITY_USERS'`,
    );
    expect(Number(stillExists[0].count)).toBe(1);
  });
});