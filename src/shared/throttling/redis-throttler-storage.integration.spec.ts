/**
 * DEF-07: the Redis throttler storage and the guard's 429, against real Redis.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT SPECS
 * The counters are the whole point of `DEF-07`, and the properties that matter —
 * that concurrent requests cannot both pass, that a window actually expires, and
 * that an unreachable Redis fails OPEN — are properties of the Lua script and the
 * real client, not of a mocked one. There is NO Redis mock in this file: the
 * happy-path tests drive a real node-redis client, and the fail-open test drives
 * a real client that is simply not connected.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 REDIS_HOST=<host> REDIS_PORT=<port> REDIS_DATABASE=15 \
 *     npx jest src/shared/throttling/redis-throttler-storage.integration
 * The spec needs Redis only — it never opens Postgres — but it is gated by the
 * same `RUN_DB_INTEGRATION` switch as the other integration specs, so hermetic
 * `npm test` never needs Redis and CI (which does not set the variable) skips it
 * entirely. Point REDIS_DATABASE at a scratch index (15, like the gate).
 *
 * Every key it writes carries a per-run prefix and is deleted in `afterAll`.
 */
import { ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerModuleOptions } from '@nestjs/throttler';
import { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { DefThrottlerGuard } from './def-throttler.guard';
import { RedisThrottlerStorage, THROTTLE_KEY_PREFIX } from './redis-throttler.storage';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

const redisUrl = () =>
  `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}/${
    process.env.REDIS_DATABASE || '0'
  }`;

type RedisClient = ReturnType<typeof createClient>;

describeIntegration('RedisThrottlerStorage + DefThrottlerGuard (real Redis)', () => {
  let client: RedisClient;
  let storage: RedisThrottlerStorage;
  const prefix = `it:${randomUUID()}:`;
  const written: string[] = [];

  /** A key unique to this run; recorded so `afterAll` can delete it. */
  const key = (name: string) => {
    written.push(`${THROTTLE_KEY_PREFIX}${prefix}${name}`);
    return `${prefix}${name}`;
  };

  beforeAll(async () => {
    client = createClient({ url: redisUrl() });
    client.on('error', () => {});
    await client.connect();
    storage = new RedisThrottlerStorage({ store: { client } } as unknown as Cache);
  });

  afterAll(async () => {
    if (!client?.isOpen) return;
    if (written.length) await client.del(written);
    await client.quit();
  });

  /**
   * A guard over the REAL storage. `generateKey` is overridden to return the
   * tracker, so the Redis key is the one this spec generated and can delete —
   * otherwise it would be the library's sha256 of several inputs.
   */
  const makeGuard = async (name: string, limit: number, ttl: number, tracker: string) => {
    const options: ThrottlerModuleOptions = {
      throttlers: [
        { name, limit, ttl, blockDuration: 0, getTracker: () => tracker, generateKey: (_c, t) => t },
      ],
    };
    const guard = new DefThrottlerGuard(options, storage, new Reflector());
    await guard.onModuleInit();
    return guard;
  };

  const makeContext = () => {
    const headers: Record<string, string | number> = {};
    const request = { ip: '203.0.113.9', body: {} };
    const response = {
      header: (name: string, value: string | number) => {
        headers[name] = value;
      },
      setHeader: (name: string, value: string | number) => {
        headers[name] = value;
      },
    };
    function throttleProbeHandler() {
      /* the handler name only feeds the key generator, which is overridden */
    }
    class ThrottleProbeController {}
    const context = {
      getHandler: () => throttleProbeHandler,
      getClass: () => ThrottleProbeController,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;
    return { context, headers };
  };

  it('allows `limit` requests, then answers 429 with Retry-After', async () => {
    const guard = await makeGuard('probe', 3, 60_000, key('guard'));
    const { context, headers } = makeContext();

    for (let i = 0; i < 3; i++) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    const error = await guard.canActivate(context).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ThrottlerException);
    expect((error as ThrottlerException).getStatus()).toBe(429);
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('keeps separate keys independent', async () => {
    const exhausted = key('independent-a');
    const untouched = key('independent-b');

    for (let i = 0; i < 2; i++) {
      await storage.increment(exhausted, 60_000, 2, 0, 'probe');
    }
    const blocked = await storage.increment(exhausted, 60_000, 2, 0, 'probe');
    const other = await storage.increment(untouched, 60_000, 2, 0, 'probe');

    expect(blocked.isBlocked).toBe(true);
    expect(other.isBlocked).toBe(false);
    expect(other.totalHits).toBe(1);
  });

  it('lets the window expire and allows the key again', async () => {
    const expiring = key('expiry');

    await storage.increment(expiring, 300, 1, 0, 'probe');
    const blocked = await storage.increment(expiring, 300, 1, 0, 'probe');
    expect(blocked.isBlocked).toBe(true);

    // The window is 300 ms; wait just past it, not longer.
    await new Promise((resolve) => setTimeout(resolve, 350));

    const afterWindow = await storage.increment(expiring, 300, 1, 0, 'probe');
    expect(afterWindow.isBlocked).toBe(false);
    expect(afterWindow.totalHits).toBe(1);
  });

  it('lets exactly `limit` of N parallel requests through (the script is atomic)', async () => {
    const parallel = key('parallel');

    const results = await Promise.all(
      Array.from({ length: 20 }, () => storage.increment(parallel, 60_000, 5, 0, 'probe')),
    );

    expect(results.filter((record) => !record.isBlocked)).toHaveLength(5);
    expect(results.filter((record) => record.isBlocked)).toHaveLength(15);
  });

  it('fails open with a log line when Redis is unreachable', async () => {
    // A REAL client that is not connected: every command rejects with the
    // driver's "client is closed" error, which is the failure path under test.
    const disconnected = createClient({ url: redisUrl() });
    disconnected.on('error', () => {});
    const unreachable = new RedisThrottlerStorage({ store: { client: disconnected } } as unknown as Cache);

    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const record = await unreachable.increment(key('unreachable'), 60_000, 1, 0, 'probe');

      expect(record.isBlocked).toBe(false);
      expect(record.totalHits).toBe(1);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('fails open'));
    } finally {
      spy.mockRestore();
    }
  });
});
