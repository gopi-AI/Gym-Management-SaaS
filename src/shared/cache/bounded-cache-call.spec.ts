import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import {
  CACHE_CALL_TIMEOUT_MS_DEFAULT,
  CACHE_CALL_TIMEOUT_MS_ENV,
  CACHE_CALL_TIMEOUT_MS_MAX,
  CacheUnavailableError,
  boundedCacheCall,
  cacheCallTimeoutFrom,
  readCacheCallTimeout,
  withDeadline,
} from './bounded-cache-call';

const cacheWith = (client: unknown) => ({ store: { client } }) as unknown as Cache;

/**
 * R1 (owner ruling O2, 2026-10-04): the deadline is asserted with FAKE timers,
 * so every assertion about when the helper gives up is an assertion about the
 * helper's own scheduling rather than about how loaded the runner was. Real
 * timers must not leak out of a test that installed fake ones.
 */
afterEach(() => {
  jest.useRealTimers();
});

describe('boundedCacheCall (DEF-15)', () => {
  it('resolves with the operation result when the call answers in time', async () => {
    const client = { isReady: true };
    const operation = jest.fn().mockResolvedValue('pong');

    await expect(
      boundedCacheCall(cacheWith(client), 500, 'probe', operation),
    ).resolves.toBe('pong');
    expect(operation).toHaveBeenCalledWith(client);
  });

  it('propagates the operation failure as a cache-unavailable error, keeping it as the cause', async () => {
    // The helper wraps the operation's own rejection (owner ruling O1): every way
    // a bounded call can fail is an infrastructure failure, and the call sites
    // answer 503 by testing for ONE type. Nothing is swallowed — the original
    // failure stays reachable as `cause` and its message is kept.
    const client = { isReady: true };
    const failure = new Error('socket gone');

    const caught = await boundedCacheCall(
      cacheWith(client),
      500,
      'probe',
      () => Promise.reject(failure),
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(CacheUnavailableError);
    expect((caught as CacheUnavailableError).cause).toBe(failure);
    expect((caught as Error).message).toBe('probe: socket gone');
  });

  it('does not reject one millisecond early, and rejects with the labelled error at the deadline', async () => {
    // R1 (owner ruling O2, 2026-10-04): the deadline is driven by FAKE timers, so
    // the assertion is about the helper's own scheduling and not about how busy
    // the machine was. The previous version of this test measured elapsed wall
    // clock and needed a jitter allowance to survive a loaded runner.
    jest.useFakeTimers();
    // isReady stays true — a blackholed socket emits no error — so only the
    // deadline can end the call.
    const client = { isReady: true };
    let outcome: { settled: false } | { settled: true; error: unknown } = { settled: false };

    // The result is deliberately NOT awaited. If the deadline is ever removed the
    // call stays pending forever, and awaiting it would turn this test into a
    // jest 5 s timeout — noise that hides which behaviour broke. The assertions
    // below read the handler's effect instead, so a missing deadline fails as an
    // ASSERTION.
    void boundedCacheCall(
      cacheWith(client),
      500,
      'blacklist check',
      () => new Promise(() => undefined),
    ).then(
      () => {
        outcome = { settled: true, error: '(resolved unexpectedly)' };
      },
      (error: unknown) => {
        outcome = { settled: true, error };
      },
    );

    await jest.advanceTimersByTimeAsync(499);
    expect(outcome).toEqual({ settled: false });

    await jest.advanceTimersByTimeAsync(1);
    // The handler runs inside a closure, so the declared union is what the
    // assertions must read through; the cast is `unknown`-first because the
    // compiler has narrowed the initialiser's type by this point.
    const settled = outcome as unknown as { settled: true; error: unknown };
    expect(settled.settled).toBe(true);
    expect(settled.error).toBeInstanceOf(CacheUnavailableError);
    expect((settled.error as Error).message).toBe('blacklist check: no reply within 500 ms');
  });

  it('refuses without a round trip when the client reports it is not ready', async () => {
    const client = { isReady: false };
    const operation = jest.fn();

    await expect(boundedCacheCall(cacheWith(client), 500, 'probe', operation)).rejects.toBeInstanceOf(
      CacheUnavailableError,
    );
    await expect(boundedCacheCall(cacheWith(client), 500, 'probe', operation)).rejects.toThrow(
      /not ready/,
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('refuses when the store exposes no Redis client', async () => {
    const operation = jest.fn();

    await expect(
      boundedCacheCall(cacheWith(undefined), 500, 'probe', operation),
    ).rejects.toBeInstanceOf(CacheUnavailableError);
    await expect(boundedCacheCall(cacheWith(undefined), 500, 'probe', operation)).rejects.toThrow(
      /no Redis client/,
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('types every infrastructure failure that needs no timer as CacheUnavailableError', async () => {
    // The type has to be COMPLETE: the call sites map 503 by testing for it, so
    // an infrastructure failure arriving as anything else would be reported to
    // the client as an invalid session instead of an outage. The fourth shape,
    // the deadline, is asserted in the fake-timer test above — a never-settling
    // call cannot be awaited here without turning a missing deadline into a
    // jest timeout rather than a failed assertion.
    // Each shape is built LAZILY, immediately before it is awaited: building
    // them eagerly would leave an already-rejected promise unhandled until the
    // loop reached it, which node reports as an unhandled rejection.
    const failures: Array<[string, () => Promise<unknown>]> = [
      ['no client', () => boundedCacheCall(cacheWith(undefined), 50, 'probe', jest.fn())],
      [
        'not ready',
        () => boundedCacheCall(cacheWith({ isReady: false }), 50, 'probe', jest.fn()),
      ],
      [
        'driver error',
        () =>
          boundedCacheCall(cacheWith({ isReady: true }), 50, 'probe', () =>
            Promise.reject(new Error('READONLY')),
          ),
      ],
    ];

    for (const [shape, call] of failures) {
      const caught = await call().catch((error: unknown) => error);
      expect([shape, caught instanceof CacheUnavailableError]).toEqual([shape, true]);
    }
  });

  it('swallows a rejection from the promise it abandoned at the deadline', async () => {
    // A socket that errors after the deadline rejects the abandoned promise; an
    // unhandled rejection there would take the process down for a call whose
    // caller already has its answer.
    const late = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('late failure')), 60);
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      await expect(withDeadline(late, 20, 'probe: too slow')).rejects.toThrow(/too slow/);
      // Long enough for the abandoned promise to settle and for the runtime to
      // have reported it, had it been left unhandled.
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(unhandled).toHaveLength(0);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('labels the error with the operation name and never with a key or token', async () => {
    // Fake timers for the same reason as the test above: this call never settles
    // on its own, so a removed deadline must fail an assertion here rather than
    // hang until jest's own timeout.
    jest.useFakeTimers();
    const client = { isReady: true };
    let message: string | undefined;

    void boundedCacheCall(
      cacheWith(client),
      20,
      'blacklist lookup',
      () => new Promise(() => undefined),
    ).then(
      () => undefined,
      (error: Error) => {
        message = error.message;
      },
    );

    await jest.advanceTimersByTimeAsync(20);
    expect(message).toBe('blacklist lookup: no reply within 20 ms');
  });
});

describe('readCacheCallTimeout', () => {
  it('falls back to the documented default when the variable is unset or empty', () => {
    expect(readCacheCallTimeout(undefined)).toBe(CACHE_CALL_TIMEOUT_MS_DEFAULT);
    expect(readCacheCallTimeout(null)).toBe(CACHE_CALL_TIMEOUT_MS_DEFAULT);
    expect(readCacheCallTimeout('   ')).toBe(CACHE_CALL_TIMEOUT_MS_DEFAULT);
    expect(CACHE_CALL_TIMEOUT_MS_ENV).toBe('CACHE_CALL_TIMEOUT_MS');
  });

  it('parses a positive integer override', () => {
    expect(readCacheCallTimeout('250')).toBe(250);
    expect(readCacheCallTimeout(750)).toBe(750);
  });

  it('rejects a malformed value rather than leaving calls unbounded', () => {
    expect(() => readCacheCallTimeout('0')).toThrow(/CACHE_CALL_TIMEOUT_MS/);
    expect(() => readCacheCallTimeout('-5')).toThrow(/CACHE_CALL_TIMEOUT_MS/);
    expect(() => readCacheCallTimeout('abc')).toThrow(/CACHE_CALL_TIMEOUT_MS/);
    expect(() => readCacheCallTimeout('1.5')).toThrow(/CACHE_CALL_TIMEOUT_MS/);
    expect(() => readCacheCallTimeout('NaN')).toThrow(/CACHE_CALL_TIMEOUT_MS/);
    expect(() => readCacheCallTimeout('Infinity')).toThrow(/CACHE_CALL_TIMEOUT_MS/);
  });

  it('accepts the whole documented range, both ends inclusive', () => {
    // R6: the range is [1, CACHE_CALL_TIMEOUT_MS_MAX]. Both ends are legal and
    // the boundaries are exercised so an off-by-one cannot pass.
    expect(readCacheCallTimeout(1)).toBe(1);
    expect(readCacheCallTimeout(String(CACHE_CALL_TIMEOUT_MS_MAX))).toBe(CACHE_CALL_TIMEOUT_MS_MAX);
    expect(CACHE_CALL_TIMEOUT_MS_MAX).toBe(10_000);
  });

  it('rejects a deadline above the ceiling instead of arming a request path with it', () => {
    // R6. A deadline past the ceiling stops bounding anything and becomes the
    // outage it was meant to cut short, so it fails the boot.
    expect(() => readCacheCallTimeout(String(CACHE_CALL_TIMEOUT_MS_MAX + 1))).toThrow(
      /CACHE_CALL_TIMEOUT_MS must be an integer between 1 and 10000/,
    );
    expect(() => readCacheCallTimeout('600000')).toThrow(/between 1 and 10000/);
  });

  it('reads through a ConfigService, and defaults when there is none', () => {
    expect(cacheCallTimeoutFrom(new ConfigService({ CACHE_CALL_TIMEOUT_MS: '120' }))).toBe(120);
    expect(cacheCallTimeoutFrom(new ConfigService({}))).toBe(CACHE_CALL_TIMEOUT_MS_DEFAULT);
    expect(cacheCallTimeoutFrom(undefined)).toBe(CACHE_CALL_TIMEOUT_MS_DEFAULT);
  });
});
