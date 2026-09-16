import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { IdentityModule } from './identity/identity.module';
import { MembersModule } from './members/members.module';
import { MembershipsModule } from './memberships/memberships.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { AiModule } from './ai/ai.module';
import { isModelPriced } from './ai/config/ai-pricing';
import {
  AI_COST_LIMIT_MAX_MONTHLY_USD,
  DEFAULT_AI_COST_LIMIT_MONTHLY_USD,
  resolveAiLimit,
} from './ai/config/ai-usage-limits';
import { AuthModule } from './shared/auth/auth.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { HealthModule } from './shared/health/health.module';
import { FinanceModule } from './finance/finance.module';
import { AttendanceModule } from './attendance/attendance.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { PtModule } from './pt/pt.module';
import { DietModule } from './diet/diet.module';
import { WorkersModule } from './shared/workers/workers.module';

/**
 * Production environment validation.
 *
 * Fails fast at startup when critical secrets are missing or set to known
 * development defaults.  Development/test environments are not blocked.
 *
 * Exported purely for unit testing (see `app.module.spec.ts`); the only
 * consumer at runtime is `ConfigModule.forRoot({ validate })`.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
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
    // AI is opt-in and fail-closed: enabling it in production requires a real
    // provider configured with a key. The deterministic mock provider (which
    // fabricates output) and a key-less OpenAI provider are both rejected here,
    // at boot, rather than on the first user request.
    if (config.AI_ENABLED === 'true') {
      const aiProvider = String(config.AI_PROVIDER ?? '').trim().toLowerCase();
      if (aiProvider === 'mock') {
        throw new Error('AI_PROVIDER=mock must not be used in production.');
      }
      if (aiProvider === 'openai' && !config.AI_API_KEY) {
        throw new Error(
          'AI_API_KEY must be set in production when AI_ENABLED=true and AI_PROVIDER=openai.',
        );
      }
      // Cost control must be enforceable for the model that is actually
      // configured: an unpriced model records a NULL cost and would silently
      // bypass the monthly budget. Fail at boot instead, unless the operator
      // explicitly disabled the cost limit (AI_COST_LIMIT_MONTHLY_USD=0).
      const monthlyCostLimit = resolveAiLimit(
        config.AI_COST_LIMIT_MONTHLY_USD === undefined
          ? undefined
          : String(config.AI_COST_LIMIT_MONTHLY_USD),
        DEFAULT_AI_COST_LIMIT_MONTHLY_USD,
        0,
        AI_COST_LIMIT_MAX_MONTHLY_USD,
      );
      const aiModel = String(config.AI_MODEL ?? '').trim() || 'gpt-4o';
      if (aiProvider === 'openai' && monthlyCostLimit > 0 && !isModelPriced(aiModel)) {
        throw new Error(
          `AI_MODEL "${aiModel}" has no server-side price, so AI_COST_LIMIT_MONTHLY_USD cannot be enforced. ` +
            'Add the model to src/ai/config/ai-pricing.ts or set AI_COST_LIMIT_MONTHLY_USD=0 to disable the limit explicitly.',
        );
      }
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
    MembershipsModule,
    TenancyModule,
    // Finance (Phase 1): invoices, payments, payment retry use case.
    FinanceModule,
    // Attendance (Phase 1): front-desk check-in/out + access decision audit.
    AttendanceModule,
    // Workouts (Phase 2): exercises, templates, plan assignments, sessions.
    // PT module (built next) depends on WorkoutsService.assignPlan().
    WorkoutsModule,
    // Personal Training (Phase 2): trainers, packages, enrollments, sessions,
    // commissions. Depends on Workouts (one-directional: PT -> assignPlan) and
    // on Members for org-scoped member validation. Owns no exercise/plan tables.
    PtModule,
    // Diet/Nutrition (Phase 2): diet plans, meal templates, assignments, logs.
    DietModule,
    // Dynamic interval registration for the background workers.
    ScheduleModule.forRoot(),
    // Outbox drain, membership expiry, payment retry (all env-gated, off by default).
    WorkersModule,
    // AI foundation: provider abstraction, usage/audit telemetry, retention use case.
    AiModule,
    // Global crypto infrastructure (at-rest AES-256-GCM for MFA secrets).
    CryptoModule,
    // Unauthenticated liveness + build provenance (no tenant or config data).
    HealthModule,
  ],
})
export class AppModule {}