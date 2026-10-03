/**
 * DEF-15: every request-path cache call must be BOUNDED.
 *
 * The defect this file reproduces: the app builds its Redis client with only
 * `{url, database, ttl}` (`app.module.ts`), and `@redis/client` 1.6.1 QUEUES a
 * command while the socket is open but not answering (`isReady` stays true, no
 * reply, no error), reconnecting forever. Every call site that awaits that
 * client without a deadline therefore holds the request open for as long as the
 * outage lasts. `RedisThrottlerStorage` drew its own deadline (DEF-07);
 * everything else did not.
 *
 * WHAT THIS FILE ASSERTS
 * Each probe asserts the call SETTLES within a generous budget (4x the 500 ms
 * deadline the fix uses): before the fix a probe failed with `settled: false` —
 * that failure was the reproduction, the request never came back. What the fix
 * changed is the CALL SITES, not the driver, so the probes that exercise the
 * driver alone now go through the same helper the call sites use; the guard
 * probe drives the real class end to end and is unchanged.
 *
 * There is NO mock in this file: a real node-redis client, a real
 * `cache-manager` Redis store, and a real TCP proxy in front of real Redis.
 * `AuthService` and `AiUsageLimitService` are not constructed here because that
 * would need repository doubles, which this suite does not use — their call
 * sites are pinned in their own hermetic specs, with a cache that never settles.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 REDIS_HOST=<host> REDIS_PORT=<port> REDIS_DATABASE=15 \
 *     npx jest src/shared/auth/def-15-cache-hang.integration
 * Redis only — no Postgres. Hermetic `npm test` and CI skip it (CI sets no
 * RUN_DB_INTEGRATION). Every key carries a per-run prefix and is deleted in
 * `afterAll` through a direct (non-proxied) connection, because the proxied one
 * is blackholed by then.
 */
import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Cache, caching } from 'cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { randomUUID } from 'crypto';
import * as net from 'net';
import { createClient } from 'redis';
import {
  CACHE_CALL_TIMEOUT_MS_DEFAULT,
  boundedCacheCall,
} from '../cache/bounded-cache-call';
import { JwtAuthGuard } from './jwt-auth.guard';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

/**
 * How long a probe may take before it counts as a hang. Generous on purpose:
 * the deadline under test is 500 ms, and this must not fail a fixed call on a
 * loaded machine. Only an UPPER bound is asserted anywhere in this file.
 */
const PROBE_BUDGET_MS = 2_000;

const JWT_SECRET = 'def-15-spec-secret';

const redisTarget = () => ({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || '6379'),
  database: Number(process.env.REDIS_DATABASE || '15'),
});

const redisUrl = () =>
  `redis://${redisTarget().host}:${redisTarget().port}/${redisTarget().database}`;

const proxiedUrl = (proxyPort: number) => `redis://127.0.0.1:${proxyPort}/${redisTarget().database}`;

/**
 * A TCP proxy in front of the real Redis, so an outage can be produced that a
 * real client alone cannot: `blackhole()` keeps the listener and every socket
 * open and simply stops moving bytes, which is the shape that HANGS rather than
 * rejecting. Same helper as the DEF-07 spec, for the same reason.
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

/** The node-redis surface the unbounded call sites use. */
interface ProbeClient {
  readonly isReady?: boolean;
  incr(key: string): Promise<number>;
  incrBy(key: string, increment: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { PX?: number; EX?: number; NX?: boolean },
  ): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number>;
  disconnect(): Promise<void> | void;
}

type Outcome = { settled: true; value?: unknown; error?: unknown } | { settled: false };

const HUNG = Symbol('hung');

/**
 * Resolves with what the call did — settled with a value, settled with an error,
 * or never settled at all. `settled: false` is the defect; the assertion is on
 * that flag, never on a lower bound of elapsed time.
 */
async function settleWithin(promise: Promise<unknown>, ms: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      promise.then(
        (value) => ({ settled: true as const, value }),
        (error) => ({ settled: true as const, error }),
      ),
      new Promise<typeof HUNG>((resolve) => {
        timer = setTimeout(() => resolve(HUNG), ms);
      }),
    ]);
    return raced === HUNG ? { settled: false } : raced;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const makeGuardContext = (token: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
      getResponse: () => ({}),
    }),
    getHandler: () => function probeHandler() {
      /* the handler's identity is all the guard reads */
    },
    getClass: () => class ProbeController {},
  }) as unknown as ExecutionContext;

describeIntegration('DEF-15: request-path cache calls are bounded (real Redis)', () => {
  const prefix = `def15:${randomUUID()}:`;
  const key = (name: string) => `${prefix}${name}`;
  let proxy: RedisProxy;
  let cache: Cache;
  let client: ProbeClient;
  let guard: JwtAuthGuard;
  let token: string;
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    proxy = await startRedisProxy(redisTarget().port);
    cache = (await caching(redisStore, {
      url: proxiedUrl(proxy.port),
      database: redisTarget().database,
      ttl: 0,
    })) as unknown as Cache;
    client = (cache.store as unknown as { client: ProbeClient }).client;

    // Prove the proxied path works before it is blackholed, so a failure is
    // never "the proxy never carried anything".
    await cache.set(key('warm'), 'ok', 5_000);

    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    guard = new JwtAuthGuard(
      new Reflector(),
      new JwtService({ secret: JWT_SECRET }),
      new ConfigService({ JWT_SECRET }),
      cache,
    );
    token = new JwtService({ secret: JWT_SECRET }).sign(
      { sub: 'user-1', email: 'probe@example.test', tokenType: 'access' },
      { expiresIn: '5m' },
    );

    proxy.blackhole();
  });

  afterAll(async () => {
    errorSpy.mockRestore();
    try {
      client.disconnect();
    } catch {
      /* already gone */
    }
    proxy.drop();

    // The proxied client is blackholed, so cleanup runs on a direct connection.
    const cleaner = createClient({ url: redisUrl() });
    await cleaner.connect();
    for (const written of await cleaner.keys(`${prefix}*`)) {
      await cleaner.del(written);
    }
    await cleaner.quit();
  });

  it('the auth guard answers instead of hanging (every authenticated route)', async () => {
    const outcome = await settleWithin(guard.canActivate(makeGuardContext(token)), PROBE_BUDGET_MS);

    expect(outcome.settled).toBe(true);
  });

  // The remaining probes cover the operation SHAPES the other call sites use
  // (`auth.service`, `ai-usage-limit.service`), run through the same helper
  // those sites now run through. They assert the helper ends the call; that the
  // call sites call it, and what each answers, is pinned in their own specs.
  const bounded = <T>(label: string, operation: (redis: ProbeClient) => Promise<T>) =>
    boundedCacheCall(cache, CACHE_CALL_TIMEOUT_MS_DEFAULT, label, operation);

  it('the refresh-path blacklist read settles (auth.service isTokenBlacklisted)', async () => {
    const outcome = await settleWithin(bounded('blacklist lookup', () => cache.get(key('blacklist-read'))), PROBE_BUDGET_MS);

    expect(outcome.settled).toBe(true);
  });

  it('the blacklist write settles (auth.service blacklistToken / logout)', async () => {
    const outcome = await settleWithin(
      bounded('blacklist write', () => cache.set(key('blacklist-write'), 'true', 60_000)),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
  });

  it('the MFA challenge claim settles (auth.service verifyMfaAndLogin SET NX)', async () => {
    const outcome = await settleWithin(
      bounded('MFA challenge claim', (redis) =>
        redis.set(key('mfa-claim'), JSON.stringify('true'), { PX: 60_000, NX: true }),
      ),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
  });

  it('the AI rate-limit increment settles (ai-usage-limit assertRequestAllowed INCR)', async () => {
    const outcome = await settleWithin(
      bounded('AI rate limit INCR', (redis) => redis.incr(key('ai-rate'))),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
  });

  it('the AI budget read settles (ai-usage-limit readBudgetCounter GET)', async () => {
    const outcome = await settleWithin(
      bounded('AI budget counter GET', (redis) => redis.get(key('ai-budget'))),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
  });

  it('the AI budget hydration write settles (ai-usage-limit SET NX EX)', async () => {
    const outcome = await settleWithin(
      bounded('AI budget counter SET NX', (redis) =>
        redis.set(key('ai-hydrate'), '0', { NX: true, EX: 60 }),
      ),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
  });

  it('the AI usage-counter write settles (ai-usage-limit recordUsage INCRBY)', async () => {
    const outcome = await settleWithin(
      bounded('AI usage counter INCRBY', (redis) => redis.incrBy(key('ai-tokens'), 7)),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
  });
});
