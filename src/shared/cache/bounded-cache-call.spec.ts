import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import {
  CACHE_CALL_TIMEOUT_MS_DEFAULT,
  CACHE_CALL_TIMEOUT_MS_ENV,
  boundedCacheCall,
  cacheCallTimeoutFrom,
  readCacheCallTimeout,
  withDeadline,
} from './bounded-cache-call';

/**
 * Wall-clock slack for LOWER bounds on an elapsed measurement.
 *
 * The value measured is produced by a `setTimeout`, and a timer-driven duration
 * read with `Date.now()` can come back one millisecond SHORT of the delay it was
 * given — the clock is truncated to the millisecond and libuv ends the timer on
 * its own cached clock (measured on node v24.20.0; see the DEF-15 throttling
 * specs). The slack is small on purpose: an assertion must still fail when the
 * helper gives up far earlier than its deadline.
 */
const TIMER_JITTER_MS = 10;

const cacheWith = (client: unknown) => ({ store: { client } }) as unknown as Cache;

describe('boundedCacheCall (DEF-15)', () => {
  it('resolves with the operation result when the call answers in time', async () => {
    const client = { isReady: true };
    const operation = jest.fn().mockResolvedValue('pong');

    await expect(
      boundedCacheCall(cacheWith(client), 500, 'probe', operation),
    ).resolves.toBe('pong');
    expect(operation).toHaveBeenCalledWith(client);
  });

  it('propagates the operation error unchanged', async () => {
    const client = { isReady: true };
    const failure = new Error('socket gone');

    await expect(
      boundedCacheCall(cacheWith(client), 500, 'probe', () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  it('rejects with a labelled deadline error when the call never answers', async () => {
    // isReady stays true — a blackholed socket emits no error — so only the
    // deadline can end the call.
    const client = { isReady: true };
    const started = Date.now();

    await expect(
      boundedCacheCall(cacheWith(client), 40, 'blacklist check', () => new Promise(() => undefined)),
    ).rejects.toThrow(/blacklist check: no reply within 40 ms/);

    const elapsed = Date.now() - started;
    // No wall-clock upper bound here, deliberately. This file alone measures
    // ~50 ms for this call; the same test beside the rest of the suite measured
    // 6054 ms against a 40 ms deadline, because what the load delays is the
    // timer CALLBACK itself. An upper bound would report the runner, not the
    // helper. What has to hold is asserted instead: the call REJECTED with the
    // deadline's own message (a call that was never bounded never settles at
    // all, and jest's own per-test timeout is the backstop for that), and it did
    // not reject early.
    expect(elapsed).toBeGreaterThanOrEqual(40 - TIMER_JITTER_MS);
  });

  it('refuses without a round trip when the client reports it is not ready', async () => {
    const client = { isReady: false };
    const operation = jest.fn();

    await expect(boundedCacheCall(cacheWith(client), 500, 'probe', operation)).rejects.toThrow(
      /not ready/,
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('refuses when the store exposes no Redis client', async () => {
    const operation = jest.fn();

    await expect(boundedCacheCall(cacheWith(undefined), 500, 'probe', operation)).rejects.toThrow(
      /no Redis client/,
    );
    expect(operation).not.toHaveBeenCalled();
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
    const client = { isReady: true };

    await expect(
      boundedCacheCall(cacheWith(client), 20, 'blacklist lookup', () => new Promise(() => undefined)),
    ).rejects.toThrow(/^blacklist lookup: no reply within 20 ms$/);
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
  });

  it('reads through a ConfigService, and defaults when there is none', () => {
    expect(cacheCallTimeoutFrom(new ConfigService({ CACHE_CALL_TIMEOUT_MS: '120' }))).toBe(120);
    expect(cacheCallTimeoutFrom(new ConfigService({}))).toBe(CACHE_CALL_TIMEOUT_MS_DEFAULT);
    expect(cacheCallTimeoutFrom(undefined)).toBe(CACHE_CALL_TIMEOUT_MS_DEFAULT);
  });
});
