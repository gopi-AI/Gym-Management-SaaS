import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Member } from '../members/entities/member.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { MembershipPlan } from '../memberships/entities/membership-plan.entity';
import { MembershipHistory } from '../memberships/entities/membership-history.entity';
import { Branch } from '../tenancy/entities/branch.entity';
import { TenantSettings } from '../tenancy/entities/tenant-settings.entity';
import { AiUsage } from './entities/ai-usage.entity';
import { AiAuditEvent } from './entities/ai-audit-event.entity';
import { AiProviderService, AI_PROVIDER_TOKEN, AiProvider } from './services/ai-provider.service';
import { AiService } from './services/ai.service';
import { AiUsageLimitService } from './services/ai-usage-limit.service';
import { AiUsageService } from './services/ai-usage.service';
import { RetentionService } from './services/retention.service';
import { RetentionController } from './controllers/retention.controller';
import { PlanPerformanceService } from './services/plan-performance.service';
import { PlanPerformanceController } from './controllers/plan-performance.controller';
import { AiUsageController } from './controllers/ai-usage.controller';
import { OpenAiProvider } from './providers/openai.provider';
import { MockAiProvider } from './providers/mock.provider';

/**
 * Resolves the active provider from configuration.
 *
 * Selection is explicit and fail-closed: an unknown `AI_PROVIDER` value throws
 * at boot instead of silently falling back to a fabricated response. `mock` is
 * the development/test default because `AI_ENABLED=false` (the shipped default)
 * short-circuits every request before the provider is ever reached, and the
 * mock provider itself refuses to run under `NODE_ENV=production`.
 */
function createAiProvider(config: ConfigService): AiProvider {
  const provider = (config.get<string>('AI_PROVIDER') ?? 'mock').trim().toLowerCase();
  switch (provider) {
    case 'openai':
      return new OpenAiProvider(config);
    case 'mock':
      return new MockAiProvider(config);
    default:
      throw new Error(
        `Unsupported AI_PROVIDER "${provider}". Supported values: "openai", "mock".`,
      );
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiUsage,
      AiAuditEvent,
      // Read-only tenant-scoped aggregates consumed by the AI use cases.
      Membership,
      Member,
      MembershipPlan,
      MembershipHistory,
      Branch,
      TenantSettings,
    ]),
    // Provides the exported TenantContextService used for authorization.
    TenancyModule,
  ],
  controllers: [RetentionController, PlanPerformanceController, AiUsageController],
  providers: [
    {
      provide: AI_PROVIDER_TOKEN,
      useFactory: createAiProvider,
      inject: [ConfigService],
    },
    AiProviderService,
    AiService,
    // Rate limiting + token/cost budgets (Redis counters, AI_USAGE ledger).
    AiUsageLimitService,
    RetentionService,
    PlanPerformanceService,
    // Operator-visible usage/cost summary (read-only AI_USAGE aggregates).
    AiUsageService,
  ],
  exports: [AiService, AiUsageLimitService],
})
export class AiModule {}
