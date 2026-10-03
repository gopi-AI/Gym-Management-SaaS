/**
 * DEF-07: the Redis throttler storage and the guard's 429, against real Redis.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT SPECS
 * The counters are the whole point of `DEF-07`, and the properties that matter —
 * that concurrent requests cannot both pass, that a window actually expires, and
 * that an unreachable Redis fails OPEN — are properties of the Lua script and the
 * real client, not of a mocked one. There is NO Redis mock in this file: every
 * test drives a real node-redis client. The fail-open tests drive the three
 * shapes "unreachable" actually takes, because the driver treats them
 * differently and only one of them rejects on its own:
 *
 *  - never connected: every command rejects immediately (`ClientClosedError`);
 *  - dropped mid-run: `isReady` goes false and the driver QUEUES commands while
 *    it reconnects forever, so nothing settles on its own;
 *  - blackholed: the socket stays open and `isReady` stays true, but no reply
 *    and no error ever arrive, so only the storage's own deadline ends it.
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
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerModuleOptions } from '@nestjs/throttler';
import { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';
import * as net from 'net';
import { createClient } from 'redis';
import { DefThrottlerGuard } from './def-throttler.guard';
import { RedisThrottlerStorage, THROTTLE_KEY_PREFIX } from './redis-throttler.storage';
import { THROTTLE_STORAGE_TIMEOUT_MS_DEFAULT } from './throttle.config';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

/**
 * Wall-clock slack for the LOWER bound on the elapsed measurement below.
 *
 * The measured value comes from a `setTimeout`, and a timer-driven duration read
 * with `Date.now()` can come back one millisecond SHORT of the delay it was
 * given — the clock is truncated to the millisecond, and libuv ends the timer on
 * its own cached clock. Measured on node v24.20.0, idle: 300 x `setTimeout(40)`
 * read 39 ms in 5 runs. The slack is deliberately small: the assertion must
 * still fail if the storage abandons far earlier than its deadline.
 */
const TIMER_JITTER_MS = 10;

const redisTarget = () => ({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || '6379'),
  database: process.env.REDIS_DATABASE || '0',
});

const redisUrl = () => {
  const { host, port, database } = redisTarget();
  return `redis://${host}:${port}/${database}`;
};

/** Same Redis, reached through the in-process proxy — for the outage shapes. */
const proxiedUrl = (proxyPort: number) =>
  `redis://127.0.0.1:${proxyPort}/${redisTarget().database}`;

/**
 * A minimal TCP proxy in front of the real Redis. The outage shapes this spec
 * needs cannot be produced with a real client alone, and a mocked client is not
 * allowed here:
 *
 *  - `drop()` closes the listener and destroys every socket, so the client sees
 *    a connection that goes away mid-run and starts reconnecting into nothing;
 *  - `blackhole()` keeps the listener and the sockets open but stops moving
 *    bytes, so the client stays `isReady` and simply never hears back.
 */
interface RedisProxy {
  readonly port: number;
  blackhole(): void;
  drop(): void;
}

interface ProxyState {
  forwarding: boolean;
  readonly sockets: Set<net.Socket>;
}

async function startRedisProxy(upstreamPort: number): Promise<RedisProxy> {
  const state: ProxyState = { forwarding: true, sockets: new Set() };

  const server = net.createServer((conn) => {
    const upstream = net.connect(upstreamPort, '127.0.0.1');
    state.sockets.add(conn);
    state.sockets.add(upstream);
    const teardown = () => {
      conn.destroy();
      upstream.destroy();
    };
    conn.on('error', teardown);
    upstream.on('error', teardown);
    conn.on('close', () => state.sockets.delete(conn));
    upstream.on('close', () => state.sockets.delete(upstream));
    // Data handlers rather than `pipe`, so `blackhole()` is a flag: bytes are
    // still read off the sockets, they are just not forwarded.
    conn.on('data', (chunk) => {
      if (state.forwarding) upstream.write(chunk);
    });
    upstream.on('data', (chunk) => {
      if (state.forwarding) conn.write(chunk);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    port,
    blackhole: () => {
      state.forwarding = false;
    },
    drop: () => {
      state.forwarding = false;
      for (const socket of state.sockets) socket.destroy();
      state.sockets.clear();
      server.close();
    },
  };
}

/**
 * Fail with a named error instead of a Jest timeout, so a hang is an assertion
 * failure that says what hung.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
    // The happy-path tests are about the Lua script's counters, not about the
    // fail-open deadline, so this storage takes a deadline far above any
    // scheduling delay. Under a full parallel Jest run the worker's event loop
    // can stall past the 500 ms default and turn a HEALTHY Redis into a
    // fail-open (observed: one full-suite run, under the then-250 ms default,
    // failed the atomicity test below with "no reply within 250 ms (storage
    // timeout)" while Redis was fine). The default is exercised deliberately by
    // the deadline test at the end.
    storage = new RedisThrottlerStorage(
      { store: { client } } as unknown as Cache,
      new ConfigService({ THROTTLE_STORAGE_TIMEOUT_MS: '10000' }),
    );
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

  /** The fail-open lines a logger spy saw (the storage's other lines are irrelevant here). */
  const failOpenLines = (spy: jest.SpyInstance) =>
    spy.mock.calls.filter(([line]) => String(line).includes('fails open'));

  it('fails open with a log line when the client was never connected (the boot-time shape)', async () => {
    // A REAL client that is not connected: every command rejects with the
    // driver's "client is closed" error, which is the failure path under test.
    // This is NOT the mid-run shape — see the outage test below, where the
    // client is open and the command would be QUEUED, not rejected.
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

  it('fails open immediately when Redis drops mid-run (the client is open but not ready)', async () => {
    const proxy = await startRedisProxy(redisTarget().port);
    const proxied = createClient({ url: proxiedUrl(proxy.port) });
    proxied.on('error', () => {});
    const outageStorage = new RedisThrottlerStorage({
      store: { client: proxied },
    } as unknown as Cache);

    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await proxied.connect();
      await expect(proxied.ping()).resolves.toBe('PONG');

      proxy.drop();
      // The driver notices the drop asynchronously; wait for the state the
      // outage actually presents, which is the one that used to hang.
      const deadline = Date.now() + 5_000;
      while (proxied.isReady && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(proxied.isReady).toBe(false);
      expect(proxied.isOpen).toBe(true);

      const record = await withDeadline(
        outageStorage.increment(key('outage'), 60_000, 1, 0, 'probe'),
        1_500,
      );

      expect(record.isBlocked).toBe(false);
      expect(record.totalHits).toBe(1);
      expect(failOpenLines(spy)).toHaveLength(1);
      // The line names WHICH shape was seen: the offline client is reported as
      // "not ready". If that check were removed the command would sit queued and
      // the deadline would report a "storage timeout" instead — so this pins the
      // check without depending on wall-clock timing, which a loaded worker can
      // stretch past any bound.
      expect(String(failOpenLines(spy)[0][0])).toContain('not ready');
    } finally {
      spy.mockRestore();
      if (proxied.isOpen) proxied.disconnect();
      proxy.drop();
    }
  });

  it('fails open at the storage deadline when the socket is blackholed but still ready', async () => {
    const proxy = await startRedisProxy(redisTarget().port);
    const proxied = createClient({ url: proxiedUrl(proxy.port) });
    proxied.on('error', () => {});
    const blackholedStorage = new RedisThrottlerStorage({
      store: { client: proxied },
    } as unknown as Cache);

    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await proxied.connect();
      await expect(proxied.ping()).resolves.toBe('PONG');

      proxy.blackhole();
      // The socket never errors, so the not-ready check cannot help: only the
      // storage's own deadline can end the request.
      expect(proxied.isReady).toBe(true);

      const started = Date.now();
      const record = await withDeadline(
        blackholedStorage.increment(key('blackhole'), 60_000, 1, 0, 'probe'),
        1_500,
      );
      const elapsed = Date.now() - started;

      expect(record.isBlocked).toBe(false);
      expect(record.totalHits).toBe(1);
      // It waited for the deadline — that is the path under test, not an
      // instant failure for some other reason.
      expect(elapsed).toBeGreaterThanOrEqual(
        THROTTLE_STORAGE_TIMEOUT_MS_DEFAULT - TIMER_JITTER_MS,
      );
      expect(failOpenLines(spy)).toHaveLength(1);
    } finally {
      spy.mockRestore();
      if (proxied.isOpen) proxied.disconnect();
      proxy.drop();
    }
  });
});
