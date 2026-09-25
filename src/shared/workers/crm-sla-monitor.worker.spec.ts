import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CrmSlaMonitorWorker } from './crm-sla-monitor.worker';
import { SlaService } from '../../crm/services/sla.service';
import { WORKER_BATCH_SIZES, WORKER_INTERVALS } from './worker-config';

/**
 * Drives the real worker through its real lifecycle. The property under test is
 * the §9 responsibility split: every tick detects breaches AND escalates the ones
 * whose window has elapsed, with the same batch size, even when the detection
 * phase finds nothing.
 */
describe('CrmSlaMonitorWorker', () => {
  let worker: CrmSlaMonitorWorker;
  let slaService: { detectBreaches: jest.Mock; escalateDueBreaches: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    deleteInterval: jest.Mock;
    doesExist: jest.Mock;
  };
  let timers: NodeJS.Timeout[];
  let logSpy: jest.SpyInstance;

  const buildWorker = (env: Record<string, string>): CrmSlaMonitorWorker => {
    const configService = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new CrmSlaMonitorWorker(
      configService,
      schedulerRegistry as unknown as SchedulerRegistry,
      slaService as unknown as SlaService,
    );
  };

  beforeEach(() => {
    timers = [];
    slaService = {
      detectBreaches: jest.fn().mockResolvedValue({ followUpOverdue: 0, firstResponse: 0 }),
      escalateDueBreaches: jest.fn().mockResolvedValue({ escalated: 0 }),
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

  it('is off by default: no interval registered and neither phase runs', async () => {
    worker = buildWorker({});

    worker.onModuleInit();
    await worker.tick();

    expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    expect(slaService.detectBreaches).not.toHaveBeenCalled();
    expect(slaService.escalateDueBreaches).not.toHaveBeenCalled();
  });

  it('runs detection then escalation with the worker batch size', async () => {
    worker = buildWorker({ WORKERS_CRM_SLA_MONITOR_ENABLED: 'true' });
    worker.onModuleInit();
    slaService.detectBreaches.mockResolvedValue({ followUpOverdue: 3, firstResponse: 1 });
    slaService.escalateDueBreaches.mockResolvedValue({ escalated: 2 });

    await worker.tick();

    expect(slaService.detectBreaches).toHaveBeenCalledWith({
      limit: WORKER_BATCH_SIZES.CRM_SLA_MONITOR,
    });
    expect(slaService.escalateDueBreaches).toHaveBeenCalledWith({
      limit: WORKER_BATCH_SIZES.CRM_SLA_MONITOR,
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('3 overdue follow-up breach(es) and 1 first-response'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Escalated 2 SLA breach(es)'));
  });

  it('still escalates when detection finds nothing new', async () => {
    worker = buildWorker({ WORKERS_CRM_SLA_MONITOR_ENABLED: 'true' });
    worker.onModuleInit();
    slaService.escalateDueBreaches.mockResolvedValue({ escalated: 1 });

    await worker.tick();

    expect(slaService.escalateDueBreaches).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Escalated 1 SLA breach(es)'));
  });

  it('logs nothing when there is nothing to breach or escalate', async () => {
    worker = buildWorker({ WORKERS_CRM_SLA_MONITOR_ENABLED: 'true' });
    worker.onModuleInit();
    logSpy.mockClear();

    await worker.tick();

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('never lets a failing tick kill the schedule', async () => {
    worker = buildWorker({ WORKERS_CRM_SLA_MONITOR_ENABLED: 'true' });
    worker.onModuleInit();
    slaService.detectBreaches.mockRejectedValue(new Error('boom'));

    await expect(worker.tick()).resolves.toBeUndefined();
    // The failing detection phase means the escalation phase is not reached, and
    // the worker must survive that rather than stopping permanently.
    expect(slaService.escalateDueBreaches).not.toHaveBeenCalled();
  });

  it('uses a documented default cadence and removes its timer on destroy', () => {
    expect(WORKER_INTERVALS.CRM_SLA_MONITOR).toBe(15 * 60 * 1000);

    worker = buildWorker({ WORKERS_CRM_SLA_MONITOR_ENABLED: 'true' });
    worker.onModuleInit();
    worker.onModuleDestroy();

    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith('crm-sla-monitor-worker-interval');
  });
});
