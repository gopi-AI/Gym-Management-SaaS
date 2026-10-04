import type { ConfigService } from '@nestjs/config';
import {
  DEV_JWT_SECRET,
  buildJwtSecretOptions,
  mayUseDevJwtSecret,
  resolveJwtSecret,
} from './jwt-secret';

/**
 * Owner ruling (2026-10-05): the development JWT-secret fallback is usable only
 * when `NODE_ENV` is exactly `development` or `test`. Everything else — unset,
 * empty, `production`, `staging`, or a case variant like `Production` — must
 * supply a real secret.
 */
const ALLOWED_ENVS: Array<[string, unknown]> = [
  ['development', 'development'],
  ['test', 'test'],
];

const REFUSED_ENVS: Array<[string, unknown]> = [
  ['production', 'production'],
  ['staging', 'staging'],
  ['Production (case variant)', 'Production'],
  // Case variants of the ALLOWED values: the allowance is exact, so a
  // lowercasing implementation must still refuse these.
  ['Development (case variant)', 'Development'],
  ['TEST (case variant)', 'TEST'],
  ['an empty string', ''],
  ['undefined (unset)', undefined],
];

const SECRETS: Array<[string, unknown]> = [
  ['an unset secret', undefined],
  ['an empty secret', ''],
  ['the development literal', DEV_JWT_SECRET],
  ['a real secret', 'real-secret-value'],
];

describe('jwt-secret — development fallback scope', () => {
  describe('mayUseDevJwtSecret', () => {
    it.each(ALLOWED_ENVS)('allows NODE_ENV %s', (_label, env) => {
      expect(mayUseDevJwtSecret(env)).toBe(true);
    });

    it.each(REFUSED_ENVS)('refuses NODE_ENV %s', (_label, env) => {
      expect(mayUseDevJwtSecret(env)).toBe(false);
    });
  });

  describe('resolveJwtSecret — NODE_ENV x secret matrix', () => {
    const envs = [...ALLOWED_ENVS, ...REFUSED_ENVS];

    for (const [envLabel, env] of envs) {
      const allowed = env === 'development' || env === 'test';
      for (const [secretLabel, secret] of SECRETS) {
        const isReal = secret === 'real-secret-value';
        const outcome = isReal
          ? 'returns the real secret'
          : allowed
            ? 'returns the fallback'
            : 'throws';

        it(`NODE_ENV ${envLabel} + ${secretLabel} -> ${outcome}`, () => {
          if (isReal) {
            expect(resolveJwtSecret(secret, env)).toBe('real-secret-value');
          } else if (allowed) {
            expect(resolveJwtSecret(secret, env)).toBe(DEV_JWT_SECRET);
          } else {
            expect(() => resolveJwtSecret(secret, env)).toThrow(
              /JWT_SECRET must be set/,
            );
          }
        });
      }
    }
  });

  describe('resolveJwtSecret — error message', () => {
    const messageFor = (secret: unknown, env: unknown): string => {
      try {
        resolveJwtSecret(secret, env);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected resolveJwtSecret to throw');
    };

    it('names the rule and the accepted NODE_ENV values', () => {
      const message = messageFor(DEV_JWT_SECRET, 'staging');
      expect(message).toContain('JWT_SECRET must be set');
      expect(message).toContain("'staging'");
      expect(message).toContain("'development'");
      expect(message).toContain("'test'");
    });

    it('never prints the secret value', () => {
      // The literal is the only secret-shaped value that reaches the throw path
      // (a real secret is always accepted), and it must not appear in the message.
      expect(messageFor(DEV_JWT_SECRET, 'staging')).not.toContain(DEV_JWT_SECRET);
    });

    it('reports an unset NODE_ENV as unset', () => {
      expect(messageFor(undefined, undefined)).toContain('NODE_ENV is unset');
    });
  });

  describe('buildJwtSecretOptions (the JwtModule factory body)', () => {
    const reader = (values: Record<string, unknown>) =>
      ({
        get: (key: string, defaultValue?: unknown) =>
          key in values ? values[key] : defaultValue,
      }) as unknown as Pick<ConfigService, 'get'>;

    it('builds the fallback secret in development', () => {
      const options = buildJwtSecretOptions(reader({ NODE_ENV: 'development' }));
      expect(options.secret).toBe(DEV_JWT_SECRET);
      expect(options.signOptions).toEqual({ expiresIn: '3600s' });
    });

    it('carries a real secret through unchanged, with the configured TTL', () => {
      const options = buildJwtSecretOptions(
        reader({
          NODE_ENV: 'production',
          JWT_SECRET: 'real-secret-value',
          JWT_EXPIRATION: '900s',
        }),
      );
      expect(options.secret).toBe('real-secret-value');
      expect(options.signOptions).toEqual({ expiresIn: '900s' });
    });

    it.each([
      ['staging', 'staging'],
      ['an unset NODE_ENV', undefined],
      ['an empty NODE_ENV', ''],
      ['a case variant', 'Production'],
    ])('refuses the fallback under %s', (_label, env) => {
      expect(() =>
        buildJwtSecretOptions(reader({ NODE_ENV: env })),
      ).toThrow(/JWT_SECRET must be set/);
    });
  });
});
