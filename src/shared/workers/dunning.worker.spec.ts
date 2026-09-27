import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DunningService } from '../../finance/services/dunning.service';
import { WORKER_BATCH_SIZES, WORKER_INTERVALS } from './worker-config';
import { DunningWorker } from './dunning.worker';

describe('DunningWorker', () => {
  let service: { processOverdueInvoices: jest.Mock };
  let registry: { addInterval: jest.Mock; deleteInterval: jest.Mock; doesExist: jest.Mock };
  let timers: NodeJS.Timeout[];
  let log: jest.SpyInstance;

  const build = (env: Record<string, string> = {}) => new DunningWorker(
    { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService,
    registry as unknown as SchedulerRegistry,
    service as unknown as DunningService,
  );

  beforeEach(() => {
    timers = [];
    service = { processOverdueInvoices: jest.fn().mockResolvedValue({ scanned: 0, overdueEvents: 0, escalated: 0 }) };
    registry = {
      addInterval: jest.fn((_name: string, timer: NodeJS.Timeout) => timers.push(timer)),
      deleteInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(true),
    };
    log = jest.spyOn(Logger.prototype, 'log');
  });

  afterEach(() => {
    timers.forEach(clearInterval);
    log.mockRestore();
  });

  it('does not run or register a timer by default', async () => {
    const worker = build();
    worker.onModuleInit();
    await worker.tick();
    expect(registry.addInterval).not.toHaveBeenCalled();
    expect(service.processOverdueInvoices).not.toHaveBeenCalled();
  });

  it('uses configured background-worker cadence/batch and removes its interval', async () => {
    const worker = build({ WORKERS_DUNNING_ENABLED: 'true' });
    worker.onModuleInit();
    await worker.tick();
    expect(registry.addInterval).toHaveBeenCalledWith('finance-dunning-worker-interval', expect.anything());
    expect(log).toHaveBeenCalledWith(`DUNNING worker enabled: every ${WORKER_INTERVALS.DUNNING}ms`);
    expect(service.processOverdueInvoices).toHaveBeenCalledWith({ limit: WORKER_BATCH_SIZES.DUNNING });
    worker.onModuleDestroy();
    expect(registry.deleteInterval).toHaveBeenCalledWith('finance-dunning-worker-interval');
  });

  it('never lets a service failure escape its tick', async () => {
    const worker = build({ WORKERS_DUNNING_ENABLED: 'true' });
    worker.onModuleInit();
    service.processOverdueInvoices.mockRejectedValueOnce(new Error('scan failed'));
    await expect(worker.tick()).resolves.toBeUndefined();
    worker.onModuleDestroy();
  });
});