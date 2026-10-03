import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';
import { DefThrottlerGuard } from './def-throttler.guard';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { buildThrottlers } from './throttle.config';

/**
 * DEF-07: request throttling for the five unauthenticated endpoints.
 *
 * The storage is constructed inside the factory because `forRootAsync` runs its
 * factory in `ThrottlerModule`'s own context: only `ConfigModule` (imported
 * here) and the global `CACHE_MANAGER` are visible to it. Everything else —
 * `THROTTLER_OPTIONS` and the storage — is exported by the global
 * `ThrottlerModule`, so the guard resolves wherever it is applied with
 * `@UseGuards`.
 *
 * The guard is NOT registered as an `APP_GUARD`: throttling is per-route (Q1),
 * never app-wide.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, CACHE_MANAGER],
      useFactory: (config: ConfigService, cache: Cache) => ({
        storage: new RedisThrottlerStorage(cache, config),
        throttlers: buildThrottlers(config),
      }),
    }),
  ],
  providers: [DefThrottlerGuard],
  exports: [DefThrottlerGuard],
})
export class ThrottlingModule {}
