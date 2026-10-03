import {
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
    it('keys on the IP and the lower-cased, trimmed email', () => {
      expect(loginPairKey('203.0.113.7', '  User@Example.COM ')).toBe('203.0.113.7|user@example.com');
    });

    it('keeps two IPv6 addresses for the same email apart', () => {
      expect(loginPairKey('::1', 'a@b.c')).not.toBe(loginPairKey('::2', 'a@b.c'));
    });

    it('treats a missing or non-string email as an empty one', () => {
      expect(loginPairKey('203.0.113.7', undefined)).toBe('203.0.113.7|');
      expect(loginPairKey('203.0.113.7', { nested: true })).toBe('203.0.113.7|');
    });

    it('treats a missing IP as unknown rather than as a wildcard', () => {
      expect(loginPairKey(undefined, 'a@b.c')).toBe('unknown|a@b.c');
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
  });
});
