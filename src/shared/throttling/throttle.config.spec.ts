import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ThrottlerOptions } from '@nestjs/throttler';
import {
  MAX_KEY_USER_CHARS,
  MAX_LOGIN_PAIR_KEY_CHARS,
  THROTTLE_DEFAULTS,
  THROTTLE_NAMES,
  buildThrottlers,
  loginPairKey,
  mfaUserKey,
  mfaUserTracker,
  readThrottleNumber,
  throttleName,
  validateThrottleEnv,
} from './throttle.config';

describe('throttle configuration', () => {
  it('defines the eight counters the routes use', () => {
    expect(THROTTLE_NAMES).toEqual([
      'login-ip',
      'login-pair',
      'register-ip',
      'refresh-ip',
      'verify-mfa-ip',
      'mfa-enable-user',
      'mfa-disable-user',
      'webhook-ip',
    ]);
  });

  // Owner ruling 2026-10-05: 20 attempts per minute per user, one counter per
  // route. These read `THROTTLE_DEFAULTS` itself — the literal the app falls
  // back to in `buildThrottlers` — rather than the throttle a `ConfigService`
  // resolves, so no exported `THROTTLE_*` variable in the caller's shell can
  // satisfy them (`gym-saas-throttling`: `ConfigService.get()` reads the real
  // environment before the object a caller passes it).
  describe('the per-user MFA write counters', () => {
    it('defaults mfa-enable to 20 attempts per 60 s', () => {
      expect(THROTTLE_DEFAULTS.MFA_ENABLE_USER.limit).toBe(20);
      expect(THROTTLE_DEFAULTS.MFA_ENABLE_USER.ttlMs).toBe(60_000);
    });

    it('defaults mfa-disable to 20 attempts per 60 s', () => {
      expect(THROTTLE_DEFAULTS.MFA_DISABLE_USER.limit).toBe(20);
      expect(THROTTLE_DEFAULTS.MFA_DISABLE_USER.ttlMs).toBe(60_000);
    });
  });

  // The pin above fixes the NUMBERS; these cases fix the WIRING — that
  // `buildThrottlers` actually reads those two numbers (and the tracker) for the
  // routes, since a counter that is pinned but never built throttles nothing.
  describe('buildThrottlers wires the per-user MFA write counters', () => {
    /**
     * A ConfigService stand-in answering from a plain map. Deliberately NOT a
     * real `ConfigService`: that class resolves the live environment before the
     * object a caller passes it, so a shell with `THROTTLE_MFA_ENABLE_USER_LIMIT`
     * exported could satisfy these assertions (the trap that made a gated spec
     * fail in a runner that exported `JWT_SECRET`). `buildThrottlers` only calls
     * `get`, so the stub needs nothing else.
     */
    const configOf = (values: Record<string, unknown> = {}): ConfigService =>
      ({ get: (key: string) => values[key] }) as unknown as ConfigService;

    const entryNamed = (throttlers: ThrottlerOptions[], name: string): ThrottlerOptions => {
      const entry = throttlers.find((throttler) => throttler.name === name);

      expect(entry).toBeDefined();
      return entry!;
    };

    const ENABLE = throttleName('MFA_ENABLE_USER');
    const DISABLE = throttleName('MFA_DISABLE_USER');

    it('takes both counters from THROTTLE_DEFAULTS when nothing overrides them', () => {
      const throttlers = buildThrottlers(configOf());
      const enable = entryNamed(throttlers, ENABLE);
      const disable = entryNamed(throttlers, DISABLE);

      expect(enable.limit).toBe(20);
      expect(enable.ttl).toBe(60_000);
      expect(enable.blockDuration).toBe(0);
      expect(enable.getTracker).toBe(mfaUserTracker);

      expect(disable.limit).toBe(20);
      expect(disable.ttl).toBe(60_000);
      expect(disable.blockDuration).toBe(0);
      expect(disable.getTracker).toBe(mfaUserTracker);
    });

    it('lets an override win for mfa-enable without disturbing mfa-disable', () => {
      const throttlers = buildThrottlers(
        configOf({ THROTTLE_MFA_ENABLE_USER_LIMIT: '3', THROTTLE_MFA_ENABLE_USER_TTL_MS: '45000' }),
      );

      expect(entryNamed(throttlers, ENABLE).limit).toBe(3);
      expect(entryNamed(throttlers, ENABLE).ttl).toBe(45_000);
      // The sibling counter is its own bucket WITH its own numbers: overriding
      // one route must not retune the other.
      expect(entryNamed(throttlers, DISABLE).limit).toBe(20);
      expect(entryNamed(throttlers, DISABLE).ttl).toBe(60_000);
    });
  });

  describe('loginPairKey', () => {
    const IP = '203.0.113.7';
    /** The email half of the key — what the shape/bounding rules are about. */
    const bucketOf = (email: unknown) => loginPairKey(IP, email).split('|')[1];

    it('normalises a valid email: trimmed, lower-cased, then hashed (so the key cannot grow with it)', () => {
      const canonical = bucketOf('user@example.com');

      expect(canonical).toMatch(/^[0-9a-f]{64}$/);
      expect(bucketOf('  User@Example.COM ')).toBe(canonical);
      expect(bucketOf('USER@EXAMPLE.COM')).toBe(canonical);
      expect(bucketOf('user@example.com ')).toBe(canonical);
    });

    it('keeps distinct emails in distinct buckets', () => {
      expect(bucketOf('a@b.c')).not.toBe(bucketOf('a@b.d'));
    });

    it.each([[undefined], [null], [42], [['a@b.c']], [{ email: 'a@b.c' }], [true], ['']])(
      'maps the unusable email %p to the same bucket as an empty one',
      (value) => {
        expect(bucketOf(value)).toBe(bucketOf(''));
      },
    );

    it.each([[undefined], [null], [42], [['a@b.c']], [{ email: 'a@b.c' }], [true], ['']])(
      'never throws for the email %p',
      (value) => {
        expect(() => loginPairKey(IP, value)).not.toThrow();
      },
    );

    it('bounds a 10,000-character email instead of letting it become the key', () => {
      const key = loginPairKey(IP, `${'a'.repeat(9990)}@example.com`);

      expect(key.length).toBeLessThanOrEqual(MAX_LOGIN_PAIR_KEY_CHARS);
      expect(bucketOf(`${'a'.repeat(9990)}@example.com`)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('caps the IP half too, so a proxy-supplied value cannot grow the key', () => {
      const key = loginPairKey('9'.repeat(10_000), 'a@b.c');

      expect(key.length).toBe(MAX_LOGIN_PAIR_KEY_CHARS);
    });

    it('handles mixed-case unicode deterministically and stays bounded', () => {
      const first = loginPairKey(IP, 'ÜSER@Example.COM');

      expect(first).toBe(loginPairKey(IP, 'üser@example.com'));
      expect(first.length).toBeLessThanOrEqual(MAX_LOGIN_PAIR_KEY_CHARS);
    });

    it('keeps two IPv6 addresses for the same email apart', () => {
      expect(loginPairKey('::1', 'a@b.c')).not.toBe(loginPairKey('::2', 'a@b.c'));
    });

    it('treats a missing IP as unknown rather than as the empty string', () => {
      expect(loginPairKey(undefined, 'a@b.c').startsWith('unknown|')).toBe(true);
    });
  });

  describe('mfaUserKey', () => {
    /** Every value that is not a non-empty string shares this bucket. */
    const EMPTY_BUCKET = '';
    const UNUSABLE: ReadonlyArray<[unknown]> = [
      [undefined],
      [null],
      [42],
      [['user-1']],
      [{ userId: 'user-1' }],
      [true],
      [''],
    ];

    it('is the user id itself, unhashed, so an operator can read the counter', () => {
      expect(mfaUserKey('user-1')).toBe('user-1');
    });

    it('trims the id, so padded and unpadded callers share one bucket', () => {
      expect(mfaUserKey('  user-1  ')).toBe(mfaUserKey('user-1'));
    });

    it('keeps distinct users in distinct buckets', () => {
      expect(mfaUserKey('user-1')).not.toBe(mfaUserKey('user-2'));
    });

    it.each(UNUSABLE)('maps the unusable value %p to the shared empty bucket', (value) => {
      expect(mfaUserKey(value)).toBe(EMPTY_BUCKET);
    });

    it.each(UNUSABLE)('never throws for %p', (value) => {
      expect(() => mfaUserKey(value)).not.toThrow();
    });

    it('treats a whitespace-only id as the empty bucket, not as a bucket of its own', () => {
      expect(mfaUserKey('   ')).toBe(EMPTY_BUCKET);
    });

    it('bounds a 10,000-character id instead of letting it become the key', () => {
      expect(mfaUserKey('u'.repeat(10_000)).length).toBe(MAX_KEY_USER_CHARS);
    });
  });

  describe('mfaUserTracker', () => {
    const req = (user: unknown) => ({ user }) as Record<string, unknown>;
    const ctx = {} as ExecutionContext;

    it('reads the id the auth guard assigns to req.user', () => {
      expect(mfaUserTracker(req({ userId: 'user-1' }), ctx)).toBe('user-1');
    });

    it('collapses a request with no authenticated user to the shared empty bucket', () => {
      expect(mfaUserTracker(req(undefined), ctx)).toBe('');
      expect(mfaUserTracker(req(null), ctx)).toBe('');
      expect(mfaUserTracker({} as Record<string, unknown>, ctx)).toBe('');
    });

    it('ignores any other identity the request might carry (no IP fallback)', () => {
      expect(mfaUserTracker({ ip: '203.0.113.7' } as Record<string, unknown>, ctx)).toBe('');
    });
  });

  describe('readThrottleNumber', () => {
    it('falls back to the default when unset or blank', () => {
      expect(readThrottleNumber(undefined, 'X', 30)).toBe(30);
      expect(readThrottleNumber('', 'X', 30)).toBe(30);
    });

    it('parses a positive integer', () => {
      expect(readThrottleNumber('5', 'X', 30)).toBe(5);
    });

    it.each(['0', '-1', 'abc', '1.5'])('rejects %s', (raw) => {
      expect(() => readThrottleNumber(raw, 'X', 30)).toThrow(/X must be a positive integer/);
    });
  });

  describe('validateThrottleEnv', () => {
    it('accepts an empty environment (every default applies)', () => {
      expect(() => validateThrottleEnv({})).not.toThrow();
    });

    it('accepts valid overrides', () => {
      expect(() =>
        validateThrottleEnv({ THROTTLE_LOGIN_PAIR_LIMIT: '3', THROTTLE_LOGIN_PAIR_TTL_MS: '60000' }),
      ).not.toThrow();
    });

    it('rejects a malformed override at boot', () => {
      expect(() => validateThrottleEnv({ THROTTLE_LOGIN_IP_LIMIT: 'many' })).toThrow(
        /THROTTLE_LOGIN_IP_LIMIT/,
      );
    });

    it('accepts a valid storage deadline override', () => {
      expect(() => validateThrottleEnv({ THROTTLE_STORAGE_TIMEOUT_MS: '500' })).not.toThrow();
    });

    it('treats a blank storage deadline as unset (the default applies)', () => {
      expect(() => validateThrottleEnv({ THROTTLE_STORAGE_TIMEOUT_MS: '  ' })).not.toThrow();
    });

    it.each(['0', '-1', 'abc', '1.5', '250ms'])(
      'rejects the malformed storage deadline %s at boot',
      (raw) => {
        expect(() => validateThrottleEnv({ THROTTLE_STORAGE_TIMEOUT_MS: raw })).toThrow(
          /THROTTLE_STORAGE_TIMEOUT_MS must be a positive integer/,
        );
      },
    );
  });
});
