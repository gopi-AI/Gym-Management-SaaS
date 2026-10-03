import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { ThrottlerStorage } from '@nestjs/throttler';
import {
  THROTTLE_STORAGE_TIMEOUT_MS_DEFAULT,
  THROTTLE_STORAGE_TIMEOUT_MS_ENV,
  readThrottleNumber,
} from './throttle.config';

/**
 * The record type the `ThrottlerStorage` contract returns. Derived from the
 * interface because the package does not re-export it from its entry point.
 */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Namespace for every counter this storage owns, so they are identifiable in Redis. */
export const THROTTLE_KEY_PREFIX = 'throttle:';

/** How long further fail-open lines are folded into a count instead of printed. */
export const FAIL_OPEN_LOG_INTERVAL_MS = 30_000;

/**
 * At most one fail-open line per `intervalMs`. During a Redis outage every
 * request fails open, so a line per request would be an outage of the log
 * itself; the failures that were not printed ride as a count on the next line
 * that is. The storage holds one instance and the app builds one storage, so
 * the window is per process, which is the scope the count is meaningful in.
 */
export class FailOpenLogLimiter {
  private lastLogAt = Number.NEGATIVE_INFINITY;
  private suppressed = 0;

  constructor(
    private readonly intervalMs: number = FAIL_OPEN_LOG_INTERVAL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether this failure is printed, and how many were suppressed since the last print. */
  record(): { log: boolean; suppressedSinceLastLog: number } {
    const at = this.now();
    if (at - this.lastLogAt < this.intervalMs) {
      this.suppressed += 1;
      return { log: false, suppressedSinceLastLog: 0 };
    }
    const decision = { log: true, suppressedSinceLastLog: this.suppressed };
    this.lastLogAt = at;
    this.suppressed = 0;
    return decision;
  }
}

/**
 * One script, not two commands (DEF-07 Q3): the check, the increment and the
 * expiry all happen inside a single `EVAL`, so concurrent requests cannot read
 * the same counter and both pass, and a crash between an `INCR` and its
 * `EXPIRE` cannot leave a counter that never resets.
 *
 * KEYS[1] the counter key. ARGV[1] ttl in milliseconds, ARGV[2] the limit.
 * Returns { hits, pttlMs }: `hits` already includes a blocked request (which
 * does not increment the stored counter, mirroring @nestjs/throttler's own
 * storage), `pttlMs` is the remaining window.
 */
const INCREMENT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[1])
if current >= limit then
  local pttl = redis.call('PTTL', KEYS[1])
  if pttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ttl)
    pttl = ttl
  end
  return { current + 1, pttl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ttl)
end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
  pttl = ttl
end
return { hits, pttl }
`;

interface RedisEvalClient {
  /** node-redis exposes this as a getter; an offline client reports false. */
  readonly isReady?: boolean;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/**
 * Redis-backed `ThrottlerStorage` (DEF-07 Q3), on the client the application
 * already has (`CACHE_MANAGER` → `cache-manager-redis-yet` → node-redis) rather
 * than a second connection pool.
 *
 * Fixed-window semantics, mirroring the library's in-memory storage with
 * `blockDuration: 0`: the first `limit` requests in a window are allowed, the
 * (limit+1)-th and later are blocked, and `timeToExpire` /
 * `timeToBlockExpire` are returned in SECONDS because that is what the guard's
 * `Retry-After` header is built from.
 *
 * FAIL-OPEN (Q11): if Redis is unreachable the request is ALLOWED and a line is
 * logged. An unreachable Redis presents in three shapes, and the driver only
 * rejects one of them, so the storage draws the other two lines itself:
 *
 *  - `isReady === false` (the client is connected-but-offline, or was never
 *    connected): the driver QUEUES the command instead of rejecting it and
 *    keeps reconnecting forever, so this is checked first and the storage fails
 *    open without a round trip.
 *  - the driver rejects the `EVAL` (a real error reply, a closed socket): the
 *    catch below turns it into a fail-open line.
 *  - the driver never answers within `THROTTLE_STORAGE_TIMEOUT_MS` (default
 *    500 ms): a socket that is still `isReady` but blackholed, or a wedged
 *    server, leaves the command queued with no reply and no error, so the call
 *    is raced against a deadline.
 *
 * Without the first and third checks the promise simply stays pending for as
 * long as the outage lasts and this catch never runs — the request hangs
 * instead of being allowed, the opposite of the ruling.
 *
 * This is deliberately inconsistent with the token blacklist, which
 * fails CLOSED (`jwt-auth.guard.ts`: an unreachable Redis there must not let a
 * revoked token through). The two guards answer different questions: a failed
 * revocation check can accept a token the operator has withdrawn, while a
 * failed rate-limit check only means the mitigation is briefly absent —
 * refusing all logins whenever Redis blinks would turn a cache outage into a
 * full authentication outage.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly failOpenLog = new FailOpenLogLimiter();
  private readonly timeoutMs: number;

  /**
   * `config` is optional so the storage stays constructible on its own (specs,
   * and any future caller that has no `ConfigService`); the app passes the one
   * from `ThrottlingModule`'s factory.
   */
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    config?: ConfigService,
  ) {
    // Same parser and default as the boot check (`validateThrottleEnv`), so a
    // value that boots is also the value this deadline uses.
    this.timeoutMs = readThrottleNumber(
      config?.get(THROTTLE_STORAGE_TIMEOUT_MS_ENV),
      THROTTLE_STORAGE_TIMEOUT_MS_ENV,
      THROTTLE_STORAGE_TIMEOUT_MS_DEFAULT,
    );
  }

  private getClient(): RedisEvalClient | undefined {
    return (this.cache.store as unknown as { client?: RedisEvalClient })?.client;
  }

  /**
   * `eval` raced against `timeoutMs`.
   *
   * The deadline is not decoration. A socket that is still `isReady` but has
   * stopped answering leaves the command queued with no reply and no error:
   * the driver only settles a command once the socket errors, and it
   * reconnects forever (`@redis/client` 1.6.1's default `reconnectStrategy`),
   * so nothing else ends the request.
   */
  private async evalWithTimeout(
    client: RedisEvalClient,
    key: string,
    ttl: number,
    limit: number,
  ): Promise<unknown> {
    const evalPromise = client.eval(INCREMENT_SCRIPT, {
      keys: [`${THROTTLE_KEY_PREFIX}${key}`],
      arguments: [String(ttl), String(limit)],
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no reply within ${this.timeoutMs} ms (storage timeout)`)),
        this.timeoutMs,
      );
    });

    try {
      return await Promise.race([evalPromise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      // The abandoned promise can still settle: a reply that arrives after the
      // deadline resolves it, and a socket that errors later rejects it.
      // Neither matters to a request that has already failed open, but an
      // unhandled rejection would take the process down.
      void evalPromise.catch(() => undefined);
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const client = this.getClient();
      if (!client) throw new Error('the cache store exposes no Redis client');
      // Known-offline: waiting on `eval` would hold the request open for the
      // whole outage (see the class comment) when the timeout does not have to.
      if (client.isReady === false) throw new Error('the Redis client is not ready (offline)');

      const result = (await this.evalWithTimeout(client, key, ttl, limit)) as [number, number];
      const hits = Number(result[0]);
      const pttlMs = Number(result[1]);
      const seconds = Math.max(1, Math.ceil(pttlMs / 1000));
      const isBlocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire: seconds,
        isBlocked,
        timeToBlockExpire: isBlocked ? seconds : 0,
      };
    } catch (error) {
      // `message` is the driver's own text (or this storage's own, above): it
      // carries no key, email, token or password.
      const message = error instanceof Error ? error.message : String(error);
      const { log, suppressedSinceLastLog } = this.failOpenLog.record();
      if (log) {
        const suppressed =
          suppressedSinceLastLog > 0
            ? ` (${suppressedSinceLastLog} further failures suppressed since the last line)`
            : '';
        this.logger.error(
          `Throttling storage unavailable (${message}); allowing the request (fails open, see DEF-07 Q11)${suppressed}.`,
        );
      }
      return {
        totalHits: 1,
        timeToExpire: Math.max(1, Math.ceil(ttl / 1000)),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
