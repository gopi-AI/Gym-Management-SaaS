import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MaterializedViewRefreshWorker } from './materialized-view-refresh.worker';
import { MaterializedViewRefreshService } from '../services/materialized-view-refresh.service';
import { WORKER_INTERVALS } from '../../shared/workers/worker-config';

/**
 * Drives the real worker through its real lifecycle, in the shape
 * `membership-expiry.worker.spec.ts` established: `onModuleInit()` + `tick()` are
 * the same entry points the scheduler uses, and the registered interval is cleared
 * afterwards so nothing is left running behind the test.
 */
describe('MaterializedViewRefreshWorker', () => {
  let worker: MaterializedViewRefreshWorker;
  let refreshService: { refreshDue: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    deleteInterval: jest.Mock;
    doesExist: jest.Mock;
  };
  let timers: NodeJS.Timeout[];
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const buildWorker = (env: Record<string, string>): MaterializedViewRefreshWorker => {
    const configService = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new MaterializedViewRefreshWorker(
      configService,
      schedulerRegistry as unknown as SchedulerRegistry,
      refreshService as unknown as MaterializedViewRefreshService,
    );
  };

  beforeEach(() => {
    timers = [];
    refreshService = {
      refreshDue: jest
        .fn()
        .mockResolvedValue({ scanned: 6, refreshed: 0, skipped: 6, failed: 0 }),
    };
    schedulerRegistry = {
      addInterval: jest.fn((_name: string, timer: NodeJS.Timeout) => {
        timers.push(timer);
      }),
      deleteInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(true),
    };
    logSpy = jest.spyOn(Logger.prototype, 'log');
    errorSpy = jest.spyOn(Logger.prototype, 'error');
  });

  afterEach(() => {
    timers.forEach((timer) => clearInterval(timer));
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('runs the sweep through tick() and reports the counts it did produce', async () => {
    worker = buildWorker({
      WORKERS_ENABLED: 'true',
      WORKERS_MATERIALIZED_VIEW_REFRESH_INTERVAL_MS: '300000',
    });

    worker.onModuleInit();
    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'materialized-view-refresh-worker-interval',
      expect.anything(),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'MATERIALIZED_VIEW_REFRESH worker enabled: every 300000ms',
    );

    refreshService.refreshDue.mockResolvedValueOnce({
      scanned: 6,
      refreshed: 2,
      skipped: 4,
      failed: 0,
    });
    await worker.tick();

    expect(refreshService.refreshDue).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'Materialized views: scanned 6, refreshed 2, skipped 4, failed 0',
    );

    worker.onModuleDestroy();
    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith(
      'materialized-view-refresh-worker-interval',
    );
  });

  it('stays quiet when nothing is due and nothing failed', async () => {
    worker = buildWorker({ WORKERS_ENABLED: 'true' });
    worker.onModuleInit();

    await worker.tick();

    // The 5-minute default sweep is idle most of the time; it must not log on
    // every tick, or the log becomes useless for spotting a real refresh.
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Materialized views: scanned'),
    );

    worker.onModuleDestroy();
  });

  it('logs a sweep that had failures even when nothing refreshed', async () => {
    worker = buildWorker({ WORKERS_ENABLED: 'true' });
    worker.onModuleInit();
    refreshService.refreshDue.mockResolvedValueOnce({
      scanned: 6,
      refreshed: 0,
      skipped: 5,
      failed: 1,
    });

    await worker.tick();

    expect(logSpy).toHaveBeenCalledWith(
      'Materialized views: scanned 6, refreshed 0, skipped 5, failed 1',
    );

    worker.onModuleDestroy();
  });

  it('uses the documented default sweep interval when none is configured', () => {
    worker = buildWorker({ WORKERS_ENABLED: 'true' });

    worker.onModuleInit();

    expect(logSpy).toHaveBeenCalledWith(
      `MATERIALIZED_VIEW_REFRESH worker enabled: every ${WORKER_INTERVALS.MATERIALIZED_VIEW_REFRESH}ms`,
    );

    worker.onModuleDestroy();
  });

  it('does no work at all when the worker is disabled', async () => {
    worker = buildWorker({});

    worker.onModuleInit();
    expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();

    await worker.tick();

    expect(refreshService.refreshDue).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'MATERIALIZED_VIEW_REFRESH worker disabled (set WORKERS_ENABLED=true to enable)',
    );
  });

  it('never throws out of tick() and keeps working after a failed sweep', async () => {
    worker = buildWorker({ WORKERS_ENABLED: 'true' });
    worker.onModuleInit();

    refreshService.refreshDue.mockRejectedValueOnce(new Error('registry unreachable'));
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'MATERIALIZED_VIEW_REFRESH worker tick failed: registry unreachable',
    );

    await worker.tick();

    expect(refreshService.refreshDue).toHaveBeenCalledTimes(2);

    worker.onModuleDestroy();
  });
});