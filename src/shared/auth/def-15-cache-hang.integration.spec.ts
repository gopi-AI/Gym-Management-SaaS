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
 * deadline the fix uses) — and, since O1, asserts WHAT it settled WITH: the
 * guard probe checks it answered the 503, and the helper probes check the
 * failure arrived as a `CacheUnavailableError`. A probe that only asserted
 * `settled: true` cannot tell a bounded refusal from any other answer.
 *
 * The unbounded call is not asserted to hang from memory: the raw-client
 * CONTROL probe below runs the same shape on the same blackholed socket with no
 * helper and requires it NOT to settle. That is what makes the rest of the file
 * meaningful — it shows the blackhole really is producing the hang the deadline
 * exists to end.
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
  CacheUnavailableError,
  boundedCacheCall,
} from '../cache/bounded-cache-call';
import {
  CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  ServiceUnavailableWithRetryException,
} from '../cache/cache-unavailable.exception';
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

/**
 * The error a probe rejected with, failing loudly when the probe hung (the
 * DEF-15 defect) or resolved (which for these probes is equally wrong). Asserting
 * the answer, not just that there was one, is what tells a bounded 503 apart
 * from any other settled outcome.
 */
function rejectionOf(outcome: Outcome): unknown {
  if (!outcome.settled) {
    throw new Error('the probe never settled — the DEF-15 hang is back');
  }
  if (outcome.error === undefined) {
    throw new Error(`the probe resolved (value: ${JSON.stringify(outcome.value)}) instead of rejecting`);
  }
  return outcome.error;
}

const makeGuardContext = (token: string): ExecutionContext =>  ({
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

  it('the auth guard answers 503 for the blackholed read instead of hanging', async () => {
    const outcome = await settleWithin(guard.canActivate(makeGuardContext(token)), PROBE_BUDGET_MS);

    // DEF-15: it came back at all. Before the fix this was `settled: false` and
    // the request never returned.
    expect(outcome.settled).toBe(true);
    // R5: assert WHAT it answered, not merely that it answered. A settled call
    // that answered 401 is the O1 defect this change exists to fix, and
    // `settled: true` alone cannot tell the two apart.
    const answered = rejectionOf(outcome) as ServiceUnavailableWithRetryException;
    expect(answered).toBeInstanceOf(ServiceUnavailableWithRetryException);
    expect(answered.getStatus()).toBe(503);
    expect(answered.retryAfterSeconds).toBe(CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS);
  });

  const bounded = <T>(label: string, operation: (redis: ProbeClient) => Promise<T>) =>
    boundedCacheCall(cache, CACHE_CALL_TIMEOUT_MS_DEFAULT, label, operation);

  // ---------------------------------------------------------------------------
  // R2: the CONTROL. Everything below drives the shared helper directly, so on
  // its own it cannot show that anything was ever hanging — a helper that
  // returns proves only that the helper returns. This probe runs the SAME
  // operation shape on the SAME blackholed socket WITHOUT the helper, which is
  // what the call sites did before DEF-15: it must NOT settle. If it ever does
  // settle, the blackhole is not reproducing an outage and every "settles"
  // assertion in this file is vacuous.
  //
  // WHAT THIS WINDOW CAN AND CANNOT DETECT (measured 2026-10-04, both directions)
  // The unbounded call never settles, so ANY window shows it not settling. But
  // the control only distinguishes "never settles" from "bounded", which means a
  // replacement call bounded at or above this window is indistinguishable from
  // the hang inside it: replacing the raw call with the shared helper at its
  // default 500 ms deadline let this probe PASS unchanged, because 500 ms of
  // silence looks exactly like an outage in a 300 ms window. Replacing it with
  // the same helper at a 100 ms deadline failed the probe as intended. So the
  // control discriminates unbounded-hang from "bounded well below this window",
  // and that is the property it is here to pin.
  // ---------------------------------------------------------------------------
  const RAW_CONTROL_WINDOW_MS = 300;

  it('the unbounded raw call does NOT settle, while its bounded counterpart does', async () => {
    const raw = await settleWithin(
      // `.catch` only attaches a handler so a late rejection during teardown
      // cannot become an unhandled rejection; it never settles, so the raced
      // promise stays pending exactly as the unbounded call site did.
      client.incr(key('raw-control')).catch(() => undefined),
      RAW_CONTROL_WINDOW_MS,
    );
    expect(raw.settled).toBe(false);

    const boundedOutcome = await settleWithin(
      bounded('raw-control bounded', (redis) => redis.incr(key('raw-control-bounded'))),
      PROBE_BUDGET_MS,
    );
    expect(boundedOutcome.settled).toBe(true);
  });

  // The remaining probes cover the operation SHAPES the other call sites use
  // (`auth.service`, `ai-usage-limit.service`), run through the same helper
  // those sites now run through. They assert the helper ends the call. They do
  // NOT cover the services themselves: `AuthService` and `AiUsageLimitService`
  // are never constructed in this file, and what each site answers is pinned in
  // its own hermetic spec (`auth.service.spec.ts`,
  // `ai-usage-limit.service.spec.ts`, `jwt-auth.guard.spec.ts`).
  it('helper against a blackholed socket, blacklist-read shape (GET), settles', async () => {
    const outcome = await settleWithin(bounded('blacklist lookup', () => cache.get(key('blacklist-read'))), PROBE_BUDGET_MS);

    expect(outcome.settled).toBe(true);
    expect(rejectionOf(outcome)).toBeInstanceOf(CacheUnavailableError);
  });

  it('helper against a blackholed socket, blacklist-write shape (SET), settles', async () => {
    const outcome = await settleWithin(
      bounded('blacklist write', () => cache.set(key('blacklist-write'), 'true', 60_000)),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
    expect(rejectionOf(outcome)).toBeInstanceOf(CacheUnavailableError);
  });

  it('helper against a blackholed socket, MFA-claim shape (SET NX), settles', async () => {
    const outcome = await settleWithin(
      bounded('MFA challenge claim', (redis) =>
        redis.set(key('mfa-claim'), JSON.stringify('true'), { PX: 60_000, NX: true }),
      ),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
    expect(rejectionOf(outcome)).toBeInstanceOf(CacheUnavailableError);
  });

  it('helper against a blackholed socket, rate-limit shape (INCR), settles', async () => {
    const outcome = await settleWithin(
      bounded('AI rate limit INCR', (redis) => redis.incr(key('ai-rate'))),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
    expect(rejectionOf(outcome)).toBeInstanceOf(CacheUnavailableError);
  });

  it('helper against a blackholed socket, budget-read shape (GET), settles', async () => {
    const outcome = await settleWithin(
      bounded('AI budget counter GET', (redis) => redis.get(key('ai-budget'))),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
    expect(rejectionOf(outcome)).toBeInstanceOf(CacheUnavailableError);
  });

  it('helper against a blackholed socket, budget-hydration shape (SET NX EX), settles', async () => {
    const outcome = await settleWithin(
      bounded('AI budget counter SET NX', (redis) =>
        redis.set(key('ai-hydrate'), '0', { NX: true, EX: 60 }),
      ),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
    expect(rejectionOf(outcome)).toBeInstanceOf(CacheUnavailableError);
  });

  it('helper against a blackholed socket, usage-counter shape (INCRBY), settles', async () => {
    const outcome = await settleWithin(
      bounded('AI usage counter INCRBY', (redis) => redis.incrBy(key('ai-tokens'), 7)),
      PROBE_BUDGET_MS,
    );

    expect(outcome.settled).toBe(true);
    expect(rejectionOf(outcome)).toBeInstanceOf(CacheUnavailableError);
  });
});
