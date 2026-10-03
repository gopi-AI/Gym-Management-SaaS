import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';

/**
 * DEF-15: every request-path cache/Redis call runs under a deadline.
 *
 * WHY THIS IS NOT DECORATION
 * The app builds its Redis client with only `{url, database, ttl}`
 * (`app.module.ts`), and `@redis/client` 1.6.1 QUEUES a command instead of
 * rejecting it while the socket is open but not answering — it reconnects
 * forever on its own cached clock. A socket that is dropped from under the
 * client (`isReady === false`) and one that is open but blackholed (still
 * `isReady`, no reply, no error) both leave an unwrapped `await` pending for
 * the whole outage: the request hangs, and whatever `catch` the call site has
 * never runs. The deadline is the only thing that ends it.
 *
 * The three shapes an unreachable Redis takes, and what this module does about
 * each (`RedisThrottlerStorage` draws the same three lines — DEF-07):
 *
 *  - never connected: commands reject immediately (`ClientClosedError`), so the
 *    caller's own `catch` already works;
 *  - dropped mid-run: `isReady === false` is checked here BEFORE the round trip,
 *    so the caller fails fast instead of waiting out the deadline;
 *  - blackholed: only the deadline ends it.
 *
 * WHY IT THROWS RATHER THAN DECIDING
 * Fail-open is not a property of the cache call, it is a property of the
 * control being protected, and the two controls here answer differently on
 * purpose: a failed revocation check must refuse the token (the token
 * blacklist fails CLOSED), while a failed rate-limit check may allow the
 * request (the throttler fails OPEN, DEF-07 Q11). So this helper only ends the
 * wait and raises a labelled error; every call site's EXISTING error path
 * decides the outcome. Nothing here silently turns a blacklist read into
 * "accept the token" or an MFA claim into "skip the replay check".
 */

/**
 * The deadline for a request-path cache call. A failure bound, not a latency
 * budget: `CACHE_CALL_TIMEOUT_MS` is the tunable, and 500 ms is the default,
 * taken from the one local-host measurement this repo has (DEF-07 Q12, 2026-10-03:
 * 4.49M evals, none over 250 ms, worst 200 ms under 4 CPU hogs). Production
 * network RTT is not measured. It is a SEPARATE variable from
 * `THROTTLE_STORAGE_TIMEOUT_MS` on purpose — that one is the owner's ruling for
 * the throttler, and touching it would change a ruled behaviour.
 */
export const CACHE_CALL_TIMEOUT_MS_ENV = 'CACHE_CALL_TIMEOUT_MS';
export const CACHE_CALL_TIMEOUT_MS_DEFAULT = 500;

/**
 * Read the deadline, falling back to the documented default and throwing on a
 * value that is present but unusable — the same rule every `THROTTLE_*` number
 * uses (`readThrottleNumber`), so a typo fails the boot rather than silently
 * leaving requests unbounded.
 */
export function readCacheCallTimeout(value: unknown, envName = CACHE_CALL_TIMEOUT_MS_ENV): number {
  if (value === undefined || value === null || String(value).trim() === '') {
    return CACHE_CALL_TIMEOUT_MS_DEFAULT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer (received "${String(value)}").`);
  }
  return parsed;
}

/** The same reader against a `ConfigService`, for call sites that inject one. */
export function cacheCallTimeoutFrom(config?: ConfigService): number {
  return readCacheCallTimeout(config?.get(CACHE_CALL_TIMEOUT_MS_ENV));
}

/** node-redis exposes `isReady` as a getter; an offline client reports false. */
export interface ReadyCheckable {
  readonly isReady?: boolean;
}

/** Reaches the raw node-redis client the cache store holds, as the app does. */
export function redisClientOf<C extends ReadyCheckable>(cache: Cache): C | undefined {
  return (cache.store as unknown as { client?: C })?.client;
}

/**
 * Race one promise against the deadline. The abandoned promise is swallowed:
 * a reply that arrives after the deadline resolves it, and a socket that errors
 * later rejects it; neither matters to a caller that has already failed, but an
 * unhandled rejection would take the process down.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    void promise.catch(() => undefined);
  }
}

/**
 * One cache/Redis operation, bounded.
 *
 * Resolves the raw client, requires it to be present and ready, then runs
 * `operation` under the deadline. Everything it refuses to do — no client, a
 * client that is known-offline, a call that never answers — arrives at the
 * caller as a thrown, labelled `Error`.
 *
 * `label` names the operation and never carries a key, token, email or body:
 * these messages reach the log.
 */
export async function boundedCacheCall<T, C extends ReadyCheckable = ReadyCheckable>(
  cache: Cache,
  timeoutMs: number,
  label: string,
  operation: (client: C) => Promise<T>,
): Promise<T> {
  const client = redisClientOf<C>(cache);
  if (!client) {
    throw new Error(`${label}: the cache store exposes no Redis client`);
  }
  if (client.isReady === false) {
    throw new Error(`${label}: the Redis client is not ready (offline)`);
  }
  return withDeadline(operation(client), timeoutMs, `${label}: no reply within ${timeoutMs} ms`);
}
