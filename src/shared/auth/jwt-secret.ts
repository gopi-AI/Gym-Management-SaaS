import type { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';

/**
 * The development JWT-secret fallback, and the ONE rule that decides when it may
 * be used.
 *
 * Owner ruling (2026-10-05): the fallback is usable only when `NODE_ENV` is
 * exactly `development` or `test`. Every other value — unset, empty,
 * `production`, `staging`, or a case variant such as `Production` — must supply
 * a real secret, or the application refuses to start.
 *
 * This module exists because the same decision previously lived in three
 * copies (`validateEnv` in `src/app.module.ts`, the `JwtModule` factory in
 * `src/shared/auth/auth.module.ts`, and `AuthService.getAccessSecret()`), the
 * same divergence risk as the duplicated 23505 detector that became DEF-10. All
 * three sites now call `resolveJwtSecret()` here.
 */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

/** The only `NODE_ENV` values under which the development fallback may be used. */
export const DEV_JWT_SECRET_NODE_ENVS = ['development', 'test'] as const;

/**
 * Whether the development fallback may be used under this `NODE_ENV`.
 *
 * Exact, case-sensitive comparison: `Production` is NOT `production`, so it
 * does not earn the allowance. `undefined`/`''` do not either.
 */
export function mayUseDevJwtSecret(nodeEnv: unknown): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

/** Human-readable `NODE_ENV` for error messages. Never includes the secret. */
function describeNodeEnv(nodeEnv: unknown): string {
  if (nodeEnv === undefined || nodeEnv === null || nodeEnv === '') {
    return 'unset';
  }
  return `'${String(nodeEnv)}'`;
}

/**
 * Resolve the access-token signing secret.
 *
 * - A real (non-empty, non-default) secret is accepted in every environment and
 *   returned unchanged.
 * - A missing/empty secret, or the development literal itself, is accepted only
 *   when `mayUseDevJwtSecret(nodeEnv)` holds — then the development fallback is
 *   returned.
 * - Otherwise this throws. The message names the rule and the accepted
 *   `NODE_ENV` values and NEVER prints the secret value.
 */
export function resolveJwtSecret(rawSecret: unknown, nodeEnv: unknown): string {
  const provided =
    rawSecret === undefined || rawSecret === null ? '' : String(rawSecret);

  if (provided !== '' && provided !== DEV_JWT_SECRET) {
    return provided;
  }

  if (mayUseDevJwtSecret(nodeEnv)) {
    return DEV_JWT_SECRET;
  }

  throw new Error(
    `JWT_SECRET must be set to a real secret when NODE_ENV is ${describeNodeEnv(nodeEnv)}: ` +
      `the development default is allowed only when NODE_ENV is ${DEV_JWT_SECRET_NODE_ENVS.map(
        (value) => `'${value}'`,
      ).join(' or ')}. ` +
      'Generate one with: openssl rand -base64 32',
  );
}

/**
 * The `JwtModule` options built from a `ConfigService`-shaped reader.
 *
 * Extracted from `auth.module.ts` so the module factory is a one-line adapter
 * over the shared rule, unit-testable without building the module graph.
 */
export function buildJwtSecretOptions(
  config: Pick<ConfigService, 'get'>,
): JwtModuleOptions {
  return {
    secret: resolveJwtSecret(
      config.get<string>('JWT_SECRET'),
      config.get<string>('NODE_ENV'),
    ),
    signOptions: {
      expiresIn: config.get<string>('JWT_EXPIRATION', '3600s'),
    },
  };
}
