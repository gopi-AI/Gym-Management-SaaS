import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { ThrottlerStorage } from '@nestjs/throttler';

/**
 * The record type the `ThrottlerStorage` contract returns. Derived from the
 * interface because the package does not re-export it from its entry point.
 */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Namespace for every counter this storage owns, so they are identifiable in Redis. */
export const THROTTLE_KEY_PREFIX = 'throttle:';

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
 * logged. This is deliberately inconsistent with the token blacklist, which
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

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private getClient(): RedisEvalClient | undefined {
    return (this.cache.store as unknown as { client?: RedisEvalClient })?.client;
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
      const result = (await client.eval(INCREMENT_SCRIPT, {
        keys: [`${THROTTLE_KEY_PREFIX}${key}`],
        arguments: [String(ttl), String(limit)],
      })) as [number, number];
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
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Throttling storage unavailable (${message}); allowing the request (fails open, see DEF-07 Q11).`,
      );
      return {
        totalHits: 1,
        timeToExpire: Math.max(1, Math.ceil(ttl / 1000)),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
