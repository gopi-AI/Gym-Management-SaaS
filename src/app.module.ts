import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { IdentityModule } from './identity/identity.module';
import { MembersModule } from './members/members.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { AuthModule } from './shared/auth/auth.module';
import { CryptoModule } from './shared/crypto/crypto.module';

/**
 * Production environment validation.
 *
 * Fails fast at startup when critical secrets are missing or set to known
 * development defaults.  Development/test environments are not blocked.
 */
function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const isProduction = config.NODE_ENV === 'production';
  if (isProduction) {
    if (!config.JWT_SECRET || config.JWT_SECRET === 'dev-secret-change-me') {
      throw new Error(
        'JWT_SECRET must be set to a secure value in production. ' +
          'Generate one with: openssl rand -base64 32',
      );
    }
    if (!config.JWT_REFRESH_SECRET) {
      throw new Error(
        'JWT_REFRESH_SECRET must be set in production. ' +
          'Generate one with: openssl rand -base64 32',
      );
    }
    if (!config.MFA_ENCRYPTION_KEY) {
      throw new Error(
        'MFA_ENCRYPTION_KEY must be set in production. ' +
          'Generate one with: openssl rand -base64 32',
      );
    }
  }
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_DATABASE', 'gym_management'),
        autoLoadEntities: true,
        // Schema is managed exclusively through migrations. `synchronize` is
        // hard-disabled so a production database can never be auto-altered.
        synchronize: false,
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsTableName: 'typeorm_migrations',
        migrationsRun: configService.get<string>('DB_MIGRATIONS_RUN', 'false') === 'true',
      }),
      inject: [ConfigService],
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const username = configService.get<string>('REDIS_USERNAME', '');
        const password = configService.get<string>('REDIS_PASSWORD', '');
        const database = configService.get<number>('REDIS_DATABASE', 0);
        const ttl = configService.get<number>('REDIS_TTL', 0);

        // Build the Redis connection URL explicitly.
        // cache-manager-redis-yet@5 passes options directly to Node Redis
        // redis.createClient(), which in v4+ prefers a `url` property over
        // legacy top-level host/port.  We build: redis://[user:pass@]host:port
        let url = `redis://`;
        if (username && password) {
          url += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
        } else if (password) {
          url += `:${encodeURIComponent(password)}@`;
        }
        url += `${host}:${port}`;

        return {
          store: require('cache-manager-redis-yet').redisStore,
          url,
          database,
          ttl, // 0 means no default TTL, we will set TTL per item
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    IdentityModule,
    MembersModule,
    TenancyModule,
    // Global crypto infrastructure (at-rest AES-256-GCM for MFA secrets).
    CryptoModule,
  ],
})
export class AppModule {}