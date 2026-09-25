import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type { DataSource } from 'typeorm';
import { MaterializedViewRefreshService } from './materialized-view-refresh.service';
import { MaterializedView } from '../entities/materialized-view.entity';
import {
  DEFAULT_MATERIALIZED_VIEW_REFRESH_CADENCE_MS,
  MATERIALIZED_VIEW_REFRESH_CADENCE_MS,
  MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS,
  MATERIALIZED_VIEW_REFRESH_FAILURE_ALERT_THRESHOLD,
  isRefreshableMaterializedViewName,
} from '../constants/materialized-view-refresh';

/**
 * Unit proof of the §7.3/§7.4/§10 refresh rules.
 *
 * The database is faked deliberately at the one boundary the service owns — the
 * `REFRESH MATERIALIZED VIEW` statement — so the rules under test are the
 * *decisions* the service makes: who is due, whether `last_refreshed` is stamped,
 * how failures accumulate, and what is allowed to reach SQL text. §7.4's
 * statement itself is proven against real PostgreSQL in
 * `materialized-view-refresh.db.spec.ts`.
 */

class FakeRegistryRepository {
  rows: MaterializedView[] = [];
  updates: Array<{ id: string; patch: Partial<MaterializedView> }> = [];

  async find(_options?: unknown): Promise<MaterializedView[]> {
    return [...this.rows].sort((left, right) => left.name.localeCompare(right.name));
  }

  async findOne(options: { where: { id?: string; name?: string } }): Promise<MaterializedView | null> {
    const { id, name } = options.where;
    const found = this.rows.find((row) =>
      id !== undefined ? row.id === id : row.name === name,
    );
    return found ?? null;
  }

  async update(id: string, patch: Partial<MaterializedView>): Promise<unknown> {
    this.updates.push({ id, patch });
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) Object.assign(row, patch);
    return { affected: 1 };
  }
}

/** Minimal in-memory stand-in for the Redis cache the service is injected with. */
class FakeCache {
  private readonly entries = new Map<string, unknown>();
  readonly sets: Array<{ key: string; value: unknown; ttl?: number }> = [];

  async get<T>(key: string): Promise<T | undefined> {
    return this.entries.get(key) as T | undefined;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    this.sets.push({ key, value, ttl });
    this.entries.set(key, value);
  }
}

const buildRow = (overrides: Partial<MaterializedView>): MaterializedView =>
  ({
    id: overrides.id ?? `id-${overrides.name}`,
    name: overrides.name ?? 'reports_mv_daily_attendance',
    description: null,
    last_refreshed: null,
    ...overrides,
  }) as MaterializedView;

describe('MaterializedViewRefreshService', () => {
  let repository: FakeRegistryRepository;
  let dataSource: { query: jest.Mock };
  let cache: FakeCache;
  let service: MaterializedViewRefreshService;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    repository = new FakeRegistryRepository();
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    cache = new FakeCache();
    service = new MaterializedViewRefreshService(
      repository as never,
      dataSource as unknown as DataSource,
      cache as unknown as Cache,
    );
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  describe('§7.3 cadence', () => {
    it('uses the documented frequency per view and a default for an unlisted one', () => {
      expect(service.cadenceMs('reports_mv_daily_attendance')).toBe(
        MATERIALIZED_VIEW_REFRESH_CADENCE_MS.reports_mv_daily_attendance,
      );
      expect(service.cadenceMs('reports_mv_member_churn_monthly')).toBe(
        MATERIALIZED_VIEW_REFRESH_CADENCE_MS.reports_mv_member_churn_monthly,
      );
      // A view registered by a migration but absent from the code map still refreshes.
      expect(service.cadenceMs('reports_mv_unlisted')).toBe(
        DEFAULT_MATERIALIZED_VIEW_REFRESH_CADENCE_MS,
      );
    });

    it('refreshes every registered view exactly once when none has ever refreshed', async () => {
      repository.rows = [
        buildRow({ name: 'reports_mv_daily_attendance' }),
        buildRow({ name: 'reports_mv_daily_revenue' }),
      ];

      const summary = await service.refreshDue(new Date('2026-01-01T00:00:00Z'));

      expect(summary).toEqual({ scanned: 2, refreshed: 2, skipped: 0, failed: 0 });
      expect(dataSource.query).toHaveBeenCalledWith(
        'REFRESH MATERIALIZED VIEW "reports_mv_daily_attendance"',
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        'REFRESH MATERIALIZED VIEW "reports_mv_daily_revenue"',
      );
    });

    it('skips a view still inside its cadence window and refreshes it once elapsed', async () => {
      const now = new Date('2026-01-01T12:00:00Z');
      repository.rows = [
        buildRow({
          name: 'reports_mv_daily_attendance',
          last_refreshed: new Date(now.getTime() - 30 * 60 * 1000),
        }),
      ];

      const withinWindow = await service.refreshDue(now);
      expect(withinWindow).toEqual({ scanned: 1, refreshed: 0, skipped: 1, failed: 0 });
      expect(dataSource.query).not.toHaveBeenCalled();

      const elapsed = await service.refreshDue(
        new Date(now.getTime() + MATERIALIZED_VIEW_REFRESH_CADENCE_MS.reports_mv_daily_attendance),
      );
      expect(elapsed).toEqual({ scanned: 1, refreshed: 1, skipped: 0, failed: 0 });
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('§7.4 registration and stamping', () => {
    it('stamps last_refreshed only after a successful refresh', async () => {
      repository.rows = [buildRow({ name: 'reports_mv_daily_attendance' })];
      const refreshedAt = new Date('2026-01-02T03:04:05Z');

      await service.refreshDue(refreshedAt);

      expect(repository.updates).toEqual([
        { id: 'id-reports_mv_daily_attendance', patch: { last_refreshed: refreshedAt } },
      ]);
    });

    it('leaves the previous stamp intact when the refresh fails, and keeps sweeping', async () => {
      const previous = new Date('2025-12-31T00:00:00Z');
      repository.rows = [
        buildRow({ id: 'broken', name: 'reports_mv_broken', last_refreshed: previous }),
        buildRow({ name: 'reports_mv_daily_attendance' }),
      ];
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('reports_mv_broken')) return Promise.reject(new Error('relation is gone'));
        return Promise.resolve([]);
      });

      const summary = await service.refreshDue(new Date('2026-01-01T00:00:00Z'));

      // §10: a failed refresh is retried on the next cycle and does not stop the others.
      expect(summary).toEqual({ scanned: 2, refreshed: 1, skipped: 0, failed: 1 });
      expect(repository.updates).toEqual([
        { id: 'id-reports_mv_daily_attendance', patch: { last_refreshed: expect.any(Date) } },
      ]);
      expect(repository.rows.find((row) => row.id === 'broken')?.last_refreshed).toEqual(previous);
      expect(errorSpy).toHaveBeenCalledWith(
        'Materialized view reports_mv_broken refresh failed (1 consecutive): relation is gone',
      );
    });

    it('alerts only after the third consecutive failure, and resets the count on success', async () => {
      repository.rows = [buildRow({ name: 'reports_mv_broken' })];
      const start = new Date('2026-01-01T00:00:00Z');
      dataSource.query.mockRejectedValue(new Error('permission denied'));

      for (let attempt = 1; attempt <= MATERIALIZED_VIEW_REFRESH_FAILURE_ALERT_THRESHOLD; attempt += 1) {
        await service.refreshDue(start);
      }

      const alerts = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.startsWith('ALERT:'));
      // Exactly one alert — at the third failure, not at the first or second.
      expect(alerts).toEqual([
        `ALERT: materialized view reports_mv_broken has failed ${MATERIALIZED_VIEW_REFRESH_FAILURE_ALERT_THRESHOLD} consecutive refreshes (section 10)`,
      ]);

      // A success clears the counter, so the next failure starts again at one. The
      // row is now stamped, so the cadence window has to elapse before it is due
      // again — otherwise the sweep would correctly skip it and record nothing.
      dataSource.query.mockResolvedValue([]);
      await service.refreshDue(start);
      expect(repository.rows[0].last_refreshed).toEqual(start);

      dataSource.query.mockRejectedValue(new Error('permission denied'));
      await service.refreshDue(new Date(start.getTime() + DEFAULT_MATERIALIZED_VIEW_REFRESH_CADENCE_MS));

      const afterReset = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('refresh failed ('));
      expect(afterReset.at(-1)).toBe(
        'Materialized view reports_mv_broken refresh failed (1 consecutive): permission denied',
      );
    });
  });

  describe('the SQL-identifier guard', () => {
    it('refuses a registered name that is not a plain identifier and issues no SQL', async () => {
      repository.rows = [
        buildRow({ name: 'reports_mv_daily_attendance"; DROP TABLE "IDENTITY_USERS' }),
      ];

      const summary = await service.refreshDue(new Date());

      expect(summary).toEqual({ scanned: 1, refreshed: 0, skipped: 0, failed: 1 });
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(repository.updates).toEqual([]);
    });

    it('accepts exactly the plain-identifier shape and nothing else', () => {
      expect(isRefreshableMaterializedViewName('reports_mv_daily_attendance')).toBe(true);
      expect(isRefreshableMaterializedViewName('_reports1')).toBe(true);
      expect(isRefreshableMaterializedViewName('reports"; DROP TABLE x')).toBe(false);
      expect(isRefreshableMaterializedViewName('reports mv')).toBe(false);
      expect(isRefreshableMaterializedViewName('reports-mv')).toBe(false);
      expect(isRefreshableMaterializedViewName('')).toBe(false);
      expect(isRefreshableMaterializedViewName('1reports')).toBe(false);
      expect(isRefreshableMaterializedViewName('a'.repeat(201))).toBe(false);
      expect(isRefreshableMaterializedViewName(undefined)).toBe(false);
    });
  });

  describe('§4.3 on-demand refresh', () => {
    it('refreshes one view by registry id and returns the stamped row', async () => {
      repository.rows = [buildRow({ id: 'row-1', name: 'reports_mv_daily_attendance' })];

      const refreshed = await service.refreshById('row-1');

      expect(dataSource.query).toHaveBeenCalledWith(
        'REFRESH MATERIALIZED VIEW "reports_mv_daily_attendance"',
      );
      expect(refreshed.last_refreshed).toBeInstanceOf(Date);
    });

    it('is a 404 for an unknown registry id', async () => {
      await expect(service.refreshById('missing')).rejects.toThrow('Materialized view not found');
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('reports a failed on-demand refresh as 503 rather than a false success', async () => {
      repository.rows = [buildRow({ id: 'row-1', name: 'reports_mv_daily_attendance' })];
      dataSource.query.mockRejectedValue(new Error('lock timeout'));

      await expect(service.refreshById('row-1')).rejects.toThrow(
        /could not be refreshed; it will be retried on the next refresh cycle/,
      );
      expect(repository.updates).toEqual([]);
    });

    it('is not debounced, so an explicit refresh is never refused', async () => {
      repository.rows = [buildRow({ id: 'row-1', name: 'reports_mv_daily_attendance' })];

      await service.refreshById('row-1');
      await service.refreshById('row-1');

      expect(dataSource.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('§7.3 event-triggered refresh (debounced)', () => {
    it('refreshes once and then debounces for the 5-minute window', async () => {
      repository.rows = [buildRow({ name: 'reports_mv_daily_revenue' })];

      await expect(service.refreshOnEvent('reports_mv_daily_revenue')).resolves.toBe(true);
      await expect(service.refreshOnEvent('reports_mv_daily_revenue')).resolves.toBe(false);

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(cache.sets).toContainEqual({
        key: 'reports:mv:refresh:debounce:reports_mv_daily_revenue',
        value: true,
        ttl: MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS,
      });
      expect(debugSpy).toHaveBeenCalledWith(
        'Materialized view reports_mv_daily_revenue refresh debounced (section 7.3: at most once per 300s)',
      );
    });

    it('ignores an event for an unregistered view without querying a view', async () => {
      await expect(service.refreshOnEvent('reports_mv_not_registered')).resolves.toBe(false);

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        'Materialized view reports_mv_not_registered is not registered; event refresh ignored',
      );
    });
  });
});