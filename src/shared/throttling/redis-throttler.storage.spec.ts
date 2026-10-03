/**
 * Unit coverage for the storage's fail-open machinery.
 *
 * This file MOCKS Redis (a fake client object), deliberately: the real-client
 * behaviour — a socket that drops, a socket that stops answering — lives in
 * `redis-throttler-storage.integration.spec.ts`, which drives a real node-redis
 * client against real Redis. What is tested here is the storage's own logic:
 * which shapes it refuses to wait on, what it does at the deadline, and how it
 * keeps an outage from flooding the log.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { FailOpenLogLimiter, RedisThrottlerStorage } from './redis-throttler.storage';
import { THROTTLE_STORAGE_TIMEOUT_MS_DEFAULT } from './throttle.config';

/** A cache whose store exposes the fake client — the shape `cache-manager-redis-yet` builds. */
const cacheWith = (client: unknown) => ({ store: { client } }) as unknown as Cache;

const timeoutConfig = (ms: number) =>
  new ConfigService({ THROTTLE_STORAGE_TIMEOUT_MS: String(ms) });

describe('RedisThrottlerStorage (fail-open paths)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const failOpenLines = () => logSpy.mock.calls.filter(([line]) => String(line).includes('fails open'));

  it('does not call Redis at all when the client reports it is not ready', async () => {
    // The shape a mid-run outage presents: the driver QUEUES a command on a
    // client that is open but not ready, so waiting would hang.
    const client = { isReady: false, eval: jest.fn() };
    const storage = new RedisThrottlerStorage(cacheWith(client));

    const record = await storage.increment('k', 60_000, 1, 0, 'probe');

    expect(client.eval).not.toHaveBeenCalled();
    expect(record).toMatchObject({ totalHits: 1, isBlocked: false, timeToBlockExpire: 0 });
    expect(failOpenLines()).toHaveLength(1);
    expect(String(failOpenLines()[0][0])).toContain('not ready');
  });

  it('fails open when the client rejects the eval', async () => {
    const client = { isReady: true, eval: jest.fn().mockRejectedValue(new Error('socket gone')) };
    const storage = new RedisThrottlerStorage(cacheWith(client));

    const record = await storage.increment('k', 60_000, 1, 0, 'probe');

    expect(record.isBlocked).toBe(false);
    expect(failOpenLines()).toHaveLength(1);
    expect(String(failOpenLines()[0][0])).toContain('socket gone');
  });

  it('abandons an eval that never answers at the configured deadline', async () => {
    // isReady stays true — a blackholed socket emits no error — so only the
    // deadline can end the request.
    const client = { isReady: true, eval: jest.fn(() => new Promise(() => undefined)) };
    const storage = new RedisThrottlerStorage(cacheWith(client), timeoutConfig(40));

    const started = Date.now();
    const record = await storage.increment('k', 60_000, 1, 0, 'probe');
    const elapsed = Date.now() - started;

    expect(record.isBlocked).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(1_000);
    expect(failOpenLines()).toHaveLength(1);
    expect(String(failOpenLines()[0][0])).toContain('storage timeout');
  });

  it('uses the documented default deadline when no configuration is supplied', async () => {
    const client = { isReady: true, eval: jest.fn(() => new Promise(() => undefined)) };
    const storage = new RedisThrottlerStorage(cacheWith(client));

    const started = Date.now();
    await storage.increment('k', 60_000, 1, 0, 'probe');
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(THROTTLE_STORAGE_TIMEOUT_MS_DEFAULT);
    expect(elapsed).toBeLessThan(THROTTLE_STORAGE_TIMEOUT_MS_DEFAULT + 1_000);
  });

  it('rejects a malformed deadline with the same parser the boot check uses', () => {
    const client = { isReady: true, eval: jest.fn() };

    expect(() => new RedisThrottlerStorage(cacheWith(client), timeoutConfig(0))).toThrow(
      /THROTTLE_STORAGE_TIMEOUT_MS/,
    );
    expect(
      () =>
        new RedisThrottlerStorage(
          cacheWith(client),
          new ConfigService({ THROTTLE_STORAGE_TIMEOUT_MS: 'abc' }),
        ),
    ).toThrow(/THROTTLE_STORAGE_TIMEOUT_MS/);
  });

  it('swallows a rejection from the eval it abandoned at the deadline', async () => {
    // A socket that errors after the deadline rejects the abandoned promise;
    // an unhandled rejection there would crash the process for a request that
    // has already failed open.
    const late = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('late failure')), 60);
    });
    const client = { isReady: true, eval: jest.fn(() => late) };
    const storage = new RedisThrottlerStorage(cacheWith(client), timeoutConfig(20));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await storage.increment('k', 60_000, 1, 0, 'probe');
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('prints one line for a burst of failures, not one per request', async () => {
    const client = { isReady: false, eval: jest.fn() };
    const storage = new RedisThrottlerStorage(cacheWith(client));

    for (let i = 0; i < 5; i++) {
      await storage.increment('k', 60_000, 1, 0, 'probe');
    }

    expect(failOpenLines()).toHaveLength(1);
  });
});

describe('FailOpenLogLimiter', () => {
  it('prints the first failure, suppresses the window, and reports the count on the next print', () => {
    let now = 0;
    const limiter = new FailOpenLogLimiter(30_000, () => now);

    expect(limiter.record()).toEqual({ log: true, suppressedSinceLastLog: 0 });

    now = 1;
    expect(limiter.record()).toEqual({ log: false, suppressedSinceLastLog: 0 });
    now = 29_999;
    expect(limiter.record()).toEqual({ log: false, suppressedSinceLastLog: 0 });

    // The two suppressed failures ride on the next line that is printed.
    now = 30_000;
    expect(limiter.record()).toEqual({ log: true, suppressedSinceLastLog: 2 });

    now = 60_000;
    expect(limiter.record()).toEqual({ log: true, suppressedSinceLastLog: 0 });
  });
});
