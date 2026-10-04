import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth.module';
import { DEV_JWT_SECRET } from './jwt-secret';

/**
 * The `JwtModule` options factory that `src/shared/auth/auth.module.ts` ACTUALLY
 * registers, found through the module metadata.
 *
 * These tests deliberately do not call `buildJwtSecretOptions` directly: the
 * helper having the right rule is not the property under test here — the
 * WIRING is. A factory that stops calling the shared rule must fail here even
 * while every helper test stays green. That exact bypass (mutation "m4b")
 * survived the first round of mutation testing; this spec exists to kill it.
 *
 * The dynamic module is matched on `.module === JwtModule` rather than on the
 * injection token, because `@nestjs/jwt` does not export `JWT_MODULE_OPTIONS`.
 */
interface ConfigReader {
  get(key: string, defaultValue?: unknown): unknown;
}

type JwtOptionsFactory = (config: ConfigReader) => {
  secret?: unknown;
  signOptions?: unknown;
};

function registeredJwtOptionsFactory(): JwtOptionsFactory {
  const imports = (Reflect.getMetadata('imports', AuthModule) ?? []) as Array<{
    module?: unknown;
    providers?: Array<{ useFactory?: unknown }>;
  }>;

  const jwtDynamic = imports.find((entry) => entry?.module === JwtModule);
  if (!jwtDynamic) {
    throw new Error(
      'AuthModule no longer registers JwtModule — this spec needs updating',
    );
  }

  const provider = (jwtDynamic.providers ?? []).find(
    (candidate) => typeof candidate?.useFactory === 'function',
  );
  if (!provider?.useFactory) {
    throw new Error('JwtModule dynamic module carries no async options factory');
  }

  return provider.useFactory as JwtOptionsFactory;
}

/** `ConfigService`-shaped stub: `key in values`, so an explicit undefined wins. */
const reader = (values: Record<string, unknown>): ConfigReader => ({
  get: (key: string, defaultValue?: unknown) =>
    key in values ? values[key] : defaultValue,
});

describe('AuthModule — the registered JwtModule options factory', () => {
  const factory = () => registeredJwtOptionsFactory();

  it('is discovered through the module metadata (the wiring under test)', () => {
    expect(typeof factory()).toBe('function');
  });

  it('refuses the development literal under NODE_ENV=production', () => {
    expect(() =>
      factory()(reader({ NODE_ENV: 'production', JWT_SECRET: DEV_JWT_SECRET })),
    ).toThrow(/JWT_SECRET must be set/);
  });

  it('refuses the development literal under NODE_ENV=staging', () => {
    expect(() =>
      factory()(reader({ NODE_ENV: 'staging', JWT_SECRET: DEV_JWT_SECRET })),
    ).toThrow(/JWT_SECRET must be set/);
  });

  it('refuses a missing secret when NODE_ENV is unset', () => {
    expect(() => factory()(reader({}))).toThrow(/JWT_SECRET must be set/);
  });

  it('accepts the development literal in development', () => {
    const options = factory()(
      reader({ NODE_ENV: 'development', JWT_SECRET: DEV_JWT_SECRET }),
    );
    expect(options.secret).toBe(DEV_JWT_SECRET);
    expect(options.signOptions).toEqual({ expiresIn: '3600s' });
  });

  it('accepts a real secret under staging', () => {
    const options = factory()(
      reader({ NODE_ENV: 'staging', JWT_SECRET: 'real-secret-value' }),
    );
    expect(options.secret).toBe('real-secret-value');
  });

  it('reads NODE_ENV from the supplied config, not from the ambient process env', () => {
    // jest pins `process.env.NODE_ENV = 'test'`; this proves the factory's
    // answer comes from the config it is handed, so nothing here depends on
    // that ambient value (or on any other environment's).
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(
        factory()(reader({ NODE_ENV: 'development' })).secret,
      ).toBe(DEV_JWT_SECRET);

      process.env.NODE_ENV = 'development';
      expect(() => factory()(reader({ NODE_ENV: 'production' }))).toThrow(
        /JWT_SECRET must be set/,
      );
    } finally {
      if (original === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = original;
      }
    }
  });
});
