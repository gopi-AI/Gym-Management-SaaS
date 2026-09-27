import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackgroundWorker } from './background-worker';
import { OutboxWorker } from './outbox.worker';
import { MembershipExpiryWorker } from './membership-expiry.worker';
import { PaymentRetryWorker } from './payment-retry.worker';
import {
  MIN_WORKER_INTERVAL_MS,
  OUTBOX_LOCK_DURATION_MS,
  WORKER_BATCH_SIZES,
  WORKER_INTERVALS,
  isWorkerEnabled,
  parseBoolean,
  workerIntervalMs,
} from './worker-config';

/**
 * Verification of worker gating and cadence.
 *
 * The security/operational property under test: a worker that is not explicitly
 * enabled must never run — not once at boot, and not on a timer. The default for
 * every worker is OFF.
 */
class TestWorker extends BackgroundWorker {
  protected readonly workerName = 'TEST';
  protected readonly workerInstanceKey = 'test-worker-interval';

  public runs = 0;

  public async runOnce(): Promise<void> {
    this.runs += 1;
  }
}

const config = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const schedulerRegistry = () =>
  ({
    addInterval: jest.fn(),
    doesExist: jest.fn().mockReturnValue(true),
    deleteInterval: jest.fn(),
  }) as unknown as SchedulerRegistry;

describe('worker configuration', () => {
  it('accepts the usual truthy spellings and rejects everything else', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
    expect(parseBoolean('YES')).toBe(true);
    expect(parseBoolean('on')).toBe(true);
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
    expect(parseBoolean('', true)).toBe(true);
  });

  it('is disabled by default and enabled by the master switch', () => {
    expect(isWorkerEnabled(config({}), 'OUTBOX')).toBe(false);
    expect(isWorkerEnabled(config({ WORKERS_ENABLED: 'false' }), 'OUTBOX')).toBe(false);
    expect(isWorkerEnabled(config({ WORKERS_ENABLED: 'true' }), 'OUTBOX')).toBe(true);
  });

  it('lets a per-worker override win over the master switch', () => {
    const masterOn = config({ WORKERS_ENABLED: 'true', WORKERS_PAYMENT_RETRY_ENABLED: 'false' });
    expect(isWorkerEnabled(masterOn, 'PAYMENT_RETRY')).toBe(false);
    expect(isWorkerEnabled(masterOn, 'OUTBOX')).toBe(true);

    const masterOff = config({ WORKERS_ENABLED: 'false', WORKERS_OUTBOX_ENABLED: 'true' });
    expect(isWorkerEnabled(masterOff, 'OUTBOX')).toBe(true);
    expect(isWorkerEnabled(masterOff, 'MEMBERSHIP_EXPIRY')).toBe(false);
  });

  it('uses the documented default interval and ignores absurd values', () => {
    expect(workerIntervalMs(config({}), 'OUTBOX')).toBe(WORKER_INTERVALS.OUTBOX);
    expect(workerIntervalMs(config({}), 'MEMBERSHIP_EXPIRY')).toBe(WORKER_INTERVALS.MEMBERSHIP_EXPIRY);
    expect(workerIntervalMs(config({}), 'PAYMENT_RETRY')).toBe(WORKER_INTERVALS.PAYMENT_RETRY);
    expect(workerIntervalMs(config({}), 'DUNNING')).toBe(WORKER_INTERVALS.DUNNING);
    expect(workerIntervalMs(config({ WORKERS_OUTBOX_INTERVAL_MS: '15000' }), 'OUTBOX')).toBe(15000);
    // Below the floor (or not a number at all) -> the default is used instead.
    expect(workerIntervalMs(config({ WORKERS_OUTBOX_INTERVAL_MS: '1' }), 'OUTBOX')).toBe(
      WORKER_INTERVALS.OUTBOX,
    );
    expect(workerIntervalMs(config({ WORKERS_OUTBOX_INTERVAL_MS: 'soon' }), 'OUTBOX')).toBe(
      WORKER_INTERVALS.OUTBOX,
    );
    expect(MIN_WORKER_INTERVAL_MS).toBe(1000);
  });
});

describe('BackgroundWorker', () => {
  beforeEach(() => {
    // The class schedules with the real `setInterval`; fake timers keep the test
    // process from being held open by a timer the mocked registry cannot clear.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers no interval at all while disabled, and never runs', async () => {
    const registry = schedulerRegistry();
    const worker = new TestWorker(config({}), registry);

    worker.onModuleInit();
    await worker.tick();

    expect(registry.addInterval).not.toHaveBeenCalled();
    expect(worker.runs).toBe(0);
  });

  it('registers one interval when enabled and removes it on destroy', () => {
    const registry = schedulerRegistry();
    const worker = new TestWorker(config({ WORKERS_TEST_ENABLED: 'true' }), registry);

    worker.onModuleInit();

    expect(registry.addInterval).toHaveBeenCalledWith(
      'test-worker-interval',
      expect.anything(),
    );

    worker.onModuleDestroy();
    expect(registry.deleteInterval).toHaveBeenCalledWith('test-worker-interval');
  });

  it('skips a tick that overlaps a running one instead of stacking batches', async () => {
    const registry = schedulerRegistry();
    const worker = new TestWorker(config({ WORKERS_TEST_ENABLED: 'true' }), registry);
    worker.onModuleInit();
    let release: () => void = () => undefined;
    worker.runOnce = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const inFlight = worker.tick();
    await worker.tick(); // must be skipped while the first tick is running
    release();
    await inFlight;

    expect(worker.runOnce).toHaveBeenCalledTimes(1);
  });

  it('never lets a failing tick kill the schedule', async () => {
    const registry = schedulerRegistry();
    const worker = new TestWorker(config({ WORKERS_TEST_ENABLED: 'true' }), registry);
    worker.onModuleInit();
    worker.runOnce = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(worker.tick()).resolves.toBeUndefined();
  });
});
