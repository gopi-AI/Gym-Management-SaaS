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
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        // cache-manager v5-compatible Redis adapter. The v4-era
        // `cache-manager-redis-store` does not satisfy the cache-manager@5
        // Store contract; `cache-manager-redis-yet@5` pairs with
        // `cache-manager@5.7.6` (its `redisStore` is a Store factory, matching
        // the `CacheStoreFactory` shape expected by @nestjs/cache-manager).
        store: require('cache-manager-redis-yet').redisStore,
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: configService.get<number>('REDIS_PORT', 6379),
        username: configService.get<string>('REDIS_USERNAME', ''), // for Redis ACL
        password: configService.get<string>('REDIS_PASSWORD', ''),
        database: configService.get<number>('REDIS_DATABASE', 0),
        ttl: configService.get<number>('REDIS_TTL', 0), // 0 means no default TTL, we will set TTL per item
      }),
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