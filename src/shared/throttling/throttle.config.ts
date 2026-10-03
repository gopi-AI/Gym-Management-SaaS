import { ConfigService } from '@nestjs/config';
import { ThrottlerGetTrackerFunction, ThrottlerOptions } from '@nestjs/throttler';
import { createHash } from 'crypto';

/**
 * DEF-07 throttling configuration.
 *
 * Every number here is a tunable DEFAULT, not a measured value (owner ruling Q2):
 * each one is overridable by environment variable, and the env name is derived
 * from the throttler key — `THROTTLE_<KEY>_LIMIT` and `THROTTLE_<KEY>_TTL_MS`
 * (e.g. `THROTTLE_LOGIN_IP_LIMIT`, `THROTTLE_LOGIN_PAIR_TTL_MS`).
 *
 * The `ttl` values are milliseconds because that is what `@nestjs/throttler`
 * passes to `ThrottlerStorage.increment`; the storage converts them to the
 * seconds its record uses.
 */
export const THROTTLE_DEFAULTS = {
  LOGIN_IP: { limit: 30, ttlMs: 60_000 },
  // The pair counter is the one that makes distributed guessing against a single
  // account expensive without letting anyone lock a victim out by email alone
  // (Q2): the key includes the caller's IP.
  LOGIN_PAIR: { limit: 10, ttlMs: 15 * 60_000 },
  REGISTER_IP: { limit: 10, ttlMs: 60 * 60_000 },
  REFRESH_IP: { limit: 60, ttlMs: 60_000 },
  VERIFY_MFA_IP: { limit: 20, ttlMs: 60_000 },
  // Q6: a high per-IP ceiling on the webhook and nothing else — a validly signed
  // event must never be rejected by anything except this ceiling.
  WEBHOOK_IP: { limit: 600, ttlMs: 60_000 },
} as const;

export type ThrottleKey = keyof typeof THROTTLE_DEFAULTS;

/** Every throttler name this app defines, in registration order. */
export const THROTTLE_NAMES: string[] = Object.keys(THROTTLE_DEFAULTS).map((key) =>
  key.toLowerCase().replace(/_/g, '-'),
);

/** `LOGIN_IP` -> `login-ip`, matching `THROTTLE_NAMES`. */
export const throttleName = (key: ThrottleKey): string => key.toLowerCase().replace(/_/g, '-');

export const throttleEnvNames = (key: ThrottleKey) => ({
  limit: `THROTTLE_${key}_LIMIT`,
  ttlMs: `THROTTLE_${key}_TTL_MS`,
});

/**
 * Read one positive-integer setting, falling back to the documented default.
 * Throws on a value that is present but unusable, so a typo fails the boot
 * (`validateEnv` runs the same parser) rather than silently disabling a limit.
 */
export function readThrottleNumber(value: unknown, envName: string, fallback: number): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer (received "${String(value)}").`);
  }
  return parsed;
}

/** Validate every `THROTTLE_*` variable present in the environment (startup check). */
export function validateThrottleEnv(config: Record<string, unknown>): void {
  for (const key of Object.keys(THROTTLE_DEFAULTS) as ThrottleKey[]) {
    const names = throttleEnvNames(key);
    readThrottleNumber(config[names.limit], names.limit, THROTTLE_DEFAULTS[key].limit);
    readThrottleNumber(config[names.ttlMs], names.ttlMs, THROTTLE_DEFAULTS[key].ttlMs);
  }
}

/**
 * The login pair key: caller IP + the lower-cased email being attempted.
 *
 * `login` is `@Public`, so `req.ip` is the only caller identity available; the
 * email comes from the request body (body parsing runs before guards). Both are
 * part of the key so that one attacker cannot spend another account's budget
 * (email-only) and one account cannot be locked out from elsewhere (IP-only).
 */
/** Longest IP component kept; an address is far shorter, but `req.ip` can echo a proxy-supplied value. */
const MAX_KEY_IP_CHARS = 64;

/** SHA-256 hex digest length. */
const EMAIL_BUCKET_CHARS = 64;

/**
 * The key is bounded at 129 characters: 64 (capped IP) + `|` + 64 (hashed email).
 * The email is HASHED rather than embedded: `req.body.email` is unauthenticated
 * input of arbitrary length, and a raw 10,000-character address would otherwise
 * become a 10,000-character Redis key. Hashing also removes any need to escape
 * whatever the caller sends.
 */
export const MAX_LOGIN_PAIR_KEY_CHARS = MAX_KEY_IP_CHARS + 1 + EMAIL_BUCKET_CHARS;

export function loginPairKey(ip: string | undefined, email: unknown): string {
  // Anything that is not a non-empty string — missing, null, a number, an array,
  // an object — is the SAME bucket as an empty email, so a malformed body cannot
  // mint a fresh counter per shape.
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const emailBucket =
    normalizedEmail === ''
      ? ''
      : createHash('sha256').update(normalizedEmail, 'utf8').digest('hex');
  const ipBucket = (ip ?? 'unknown').slice(0, MAX_KEY_IP_CHARS);
  return `${ipBucket}|${emailBucket}`;
}

/** Throttler tracker for the pair counter — see `loginPairKey`. */
export const loginPairTracker: ThrottlerGetTrackerFunction = (req) =>
  loginPairKey(typeof req.ip === 'string' ? req.ip : undefined, (req.body as Record<string, unknown>)?.email);

/**
 * Build the named throttlers for `ThrottlerModule`.
 *
 * `blockDuration: 0` selects fixed-window semantics: the counter is blocked only
 * while its window holds hits, and there is no separate block state to expire
 * (which is also what the Redis storage implements).
 */
export function buildThrottlers(config: ConfigService): ThrottlerOptions[] {
  const read = (key: ThrottleKey) => {
    const names = throttleEnvNames(key);
    return {
      name: throttleName(key),
      limit: readThrottleNumber(config.get(names.limit), names.limit, THROTTLE_DEFAULTS[key].limit),
      ttl: readThrottleNumber(config.get(names.ttlMs), names.ttlMs, THROTTLE_DEFAULTS[key].ttlMs),
      blockDuration: 0,
    };
  };
  return [
    { ...read('LOGIN_IP') },
    { ...read('LOGIN_PAIR'), getTracker: loginPairTracker },
    { ...read('REGISTER_IP') },
    { ...read('REFRESH_IP') },
    { ...read('VERIFY_MFA_IP') },
    { ...read('WEBHOOK_IP') },
  ];
}
