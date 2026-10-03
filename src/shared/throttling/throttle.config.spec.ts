import {
  MAX_LOGIN_PAIR_KEY_CHARS,
  THROTTLE_NAMES,
  loginPairKey,
  readThrottleNumber,
  validateThrottleEnv,
} from './throttle.config';

describe('throttle configuration', () => {
  it('defines the six counters the routes use', () => {
    expect(THROTTLE_NAMES).toEqual([
      'login-ip',
      'login-pair',
      'register-ip',
      'refresh-ip',
      'verify-mfa-ip',
      'webhook-ip',
    ]);
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
