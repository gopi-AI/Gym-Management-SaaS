import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CrmFollowUpsWorker } from './crm-follow-ups.worker';
import { FollowUpsService } from '../../crm/services/follow-ups.service';
import { WORKER_BATCH_SIZES, WORKER_INTERVALS } from './worker-config';

/**
 * Drives the real worker through its real lifecycle, mirroring
 * `membership-expiry.worker.spec.ts`: `onModuleInit()` + `tick()` are the same
 * entry points the scheduler uses, and the registered interval is cleared
 * afterwards so nothing is left running behind the test.
 */
describe('CrmFollowUpsWorker', () => {
  let worker: CrmFollowUpsWorker;
  let followUpsService: { generateFollowUps: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    deleteInterval: jest.Mock;
    doesExist: jest.Mock;
  };
  let timers: NodeJS.Timeout[];
  let logSpy: jest.SpyInstance;

  const buildWorker = (env: Record<string, string>): CrmFollowUpsWorker => {
    const configService = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new CrmFollowUpsWorker(
      configService,
      schedulerRegistry as unknown as SchedulerRegistry,
      followUpsService as unknown as FollowUpsService,
    );
  };

  beforeEach(() => {
    timers = [];
    followUpsService = {
      generateFollowUps: jest
        .fn()
        .mockResolvedValue({ scanned: 0, generated: 0, policies: 0 }),
    };
    schedulerRegistry = {
      addInterval: jest.fn((_name: string, timer: NodeJS.Timeout) => {
        timers.push(timer);
      }),
      deleteInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(true),
    };
    logSpy = jest.spyOn(Logger.prototype, 'log');
  });

  afterEach(() => {
    for (const timer of timers) clearInterval(timer);
  });

  it('is off by default: no interval registered and no work performed', async () => {
    worker = buildWorker({});

    worker.onModuleInit();
    await worker.tick();

    expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    expect(followUpsService.generateFollowUps).not.toHaveBeenCalled();
  });

  it('generates follow-ups with the worker batch size and registers its interval', async () => {
    worker = buildWorker({ WORKERS_CRM_FOLLOW_UPS_ENABLED: 'true' });
    worker.onModuleInit();
    followUpsService.generateFollowUps.mockResolvedValue({
      scanned: 5,
      generated: 2,
      policies: 1,
    });

    await worker.tick();

    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'crm-follow-ups-worker-interval',
      expect.anything(),
    );
    expect(followUpsService.generateFollowUps).toHaveBeenCalledWith({
      limit: WORKER_BATCH_SIZES.CRM_FOLLOW_UPS,
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Generated 2 follow-up(s)'));
  });

  it('logs nothing when a tick generates no follow-ups', async () => {
    worker = buildWorker({ WORKERS_CRM_FOLLOW_UPS_ENABLED: 'true' });
    worker.onModuleInit();
    logSpy.mockClear();

    await worker.tick();

    expect(followUpsService.generateFollowUps).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('keeps the master switch authoritative and lets the per-worker override win', async () => {
    worker = buildWorker({ WORKERS_ENABLED: 'false', WORKERS_CRM_FOLLOW_UPS_ENABLED: 'true' });
    worker.onModuleInit();
    await worker.tick();
    expect(followUpsService.generateFollowUps).toHaveBeenCalledTimes(1);

    const masterOn = buildWorker({ WORKERS_ENABLED: 'true', WORKERS_CRM_FOLLOW_UPS_ENABLED: 'false' });
    masterOn.onModuleInit();
    await masterOn.tick();
    expect(followUpsService.generateFollowUps).toHaveBeenCalledTimes(1);
  });

  it('never lets a failing tick kill the schedule', async () => {
    worker = buildWorker({ WORKERS_CRM_FOLLOW_UPS_ENABLED: 'true' });
    worker.onModuleInit();
    followUpsService.generateFollowUps.mockRejectedValue(new Error('boom'));

    await expect(worker.tick()).resolves.toBeUndefined();
  });

  it('uses a documented default cadence and removes its timer on destroy', () => {
    expect(WORKER_INTERVALS.CRM_FOLLOW_UPS).toBe(30 * 60 * 1000);

    worker = buildWorker({ WORKERS_CRM_FOLLOW_UPS_ENABLED: 'true' });
    worker.onModuleInit();
    worker.onModuleDestroy();

    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith('crm-follow-ups-worker-interval');
  });
});
