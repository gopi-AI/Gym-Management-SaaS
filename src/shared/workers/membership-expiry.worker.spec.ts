import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MembershipExpiryWorker } from './membership-expiry.worker';
import { MembershipsService } from '../../memberships/services/memberships.service';
import { WORKER_BATCH_SIZES, WORKER_INTERVALS } from './worker-config';

/**
 * Drives the real worker through its real lifecycle.
 *
 * The Phase 1 verification run only ever saw this worker log a no-op (0
 * memberships due), so `runOnce` was never actually exercised. These tests call
 * `onModuleInit()` + `tick()` synchronously — the same entry points the
 * scheduler uses — and clear the registered interval afterwards, so nothing is
 * left running behind the test.
 */
describe('MembershipExpiryWorker', () => {
  let worker: MembershipExpiryWorker;
  let membershipsService: { expireDueMemberships: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    deleteInterval: jest.Mock;
    doesExist: jest.Mock;
  };
  let timers: NodeJS.Timeout[];
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const buildWorker = (env: Record<string, string>): MembershipExpiryWorker => {
    const configService = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new MembershipExpiryWorker(
      configService,
      schedulerRegistry as unknown as SchedulerRegistry,
      membershipsService as unknown as MembershipsService,
    );
  };

  const batch = (count: number) => ({
    scanned: count,
    expired: count,
    membershipIds: Array.from({ length: count }, (_, index) => `membership-${index + 1}`),
  });

  beforeEach(() => {
    timers = [];
    membershipsService = { expireDueMemberships: jest.fn().mockResolvedValue(batch(0)) };
    schedulerRegistry = {
      addInterval: jest.fn((_name: string, timer: NodeJS.Timeout) => {
        timers.push(timer);
      }),
      deleteInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(true),
    };
    // Spies only: the real Nest logger still prints, so the test output shows
    // exactly what the worker reported.
    logSpy = jest.spyOn(Logger.prototype, 'log');
    warnSpy = jest.spyOn(Logger.prototype, 'warn');
    errorSpy = jest.spyOn(Logger.prototype, 'error');
  });

  afterEach(() => {
    // A registered interval would keep the jest worker alive.
    timers.forEach((timer) => clearInterval(timer));
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('runs the expiry batch synchronously through tick() and reports the result', async () => {
    worker = buildWorker({
      WORKERS_ENABLED: 'true',
      WORKERS_MEMBERSHIP_EXPIRY_INTERVAL_MS: '3000',
    });

    worker.onModuleInit();
    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'membership-expiry-worker-interval',
      expect.anything(),
    );
    expect(logSpy).toHaveBeenCalledWith('MEMBERSHIP_EXPIRY worker enabled: every 3000ms');

    membershipsService.expireDueMemberships.mockResolvedValueOnce(batch(1));
    await worker.tick();

    expect(membershipsService.expireDueMemberships).toHaveBeenCalledTimes(1);
    expect(membershipsService.expireDueMemberships).toHaveBeenCalledWith({
      limit: WORKER_BATCH_SIZES.MEMBERSHIP_EXPIRY,
    });
    expect(logSpy).toHaveBeenCalledWith('Expired 1 membership(s) out of 1 due candidate(s)');

    worker.onModuleDestroy();
    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith(
      'membership-expiry-worker-interval',
    );
  });

  it('uses the default hourly cadence when no interval is configured', () => {
    worker = buildWorker({ WORKERS_ENABLED: 'true' });

    worker.onModuleInit();

    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'membership-expiry-worker-interval',
      expect.anything(),
    );
    expect(logSpy).toHaveBeenCalledWith(
      `MEMBERSHIP_EXPIRY worker enabled: every ${WORKER_INTERVALS.MEMBERSHIP_EXPIRY}ms`,
    );

    worker.onModuleDestroy();
  });

  it('does no work at all when the worker is disabled', async () => {
    worker = buildWorker({});

    worker.onModuleInit();
    expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();

    await worker.tick();

    expect(membershipsService.expireDueMemberships).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'MEMBERSHIP_EXPIRY worker disabled (set WORKERS_ENABLED=true to enable)',
    );
  });

  it('never throws out of tick() and keeps working after a failed batch', async () => {
    worker = buildWorker({ WORKERS_ENABLED: 'true' });
    worker.onModuleInit();

    membershipsService.expireDueMemberships.mockRejectedValueOnce(new Error('database is on fire'));
    await expect(worker.tick()).resolves.toBeUndefined();
    // BackgroundWorker catches the failure and logs it: a bad batch must not
    // stop the next tick.
    expect(errorSpy).toHaveBeenCalledWith(
      'MEMBERSHIP_EXPIRY worker tick failed: database is on fire',
    );

    membershipsService.expireDueMemberships.mockResolvedValueOnce(batch(2));
    await worker.tick();

    expect(membershipsService.expireDueMemberships).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith('Expired 2 membership(s) out of 2 due candidate(s)');

    worker.onModuleDestroy();
  });

  it('never overlaps two ticks', async () => {
    worker = buildWorker({ WORKERS_ENABLED: 'true' });
    worker.onModuleInit();

    let release!: (value: unknown) => void;
    membershipsService.expireDueMemberships.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = worker.tick();
    await worker.tick(); // fires while the first batch is still in flight

    expect(membershipsService.expireDueMemberships).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'MEMBERSHIP_EXPIRY worker tick skipped: previous tick still running',
    );

    release(batch(0));
    await first;
    worker.onModuleDestroy();
  });
});
