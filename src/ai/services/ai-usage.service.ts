import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsage } from '../entities/ai-usage.entity';
import { AiProviderService } from './ai-provider.service';
import { AiUsageLimitService } from './ai-usage-limit.service';
import {
  AI_RATE_LIMIT_WINDOW_SECONDS,
  TimeWindow,
  toCounterNumber,
  utcDayBounds,
  utcDayKey,
  utcMonthBounds,
  utcMonthKey,
} from '../config/ai-usage-limits';
import {
  AiUsageRequestTypeDto,
  AiUsageResponseDto,
  AiUsageWindowDto,
} from '../dto/ai-usage-response.dto';

/** Aggregated columns selected by the aggregate queries below. */
interface UsageAggregateRow {
  requests: string | number | null;
  failed_requests: string | number | null;
  total_tokens: string | number | null;
  estimated_cost_usd: string | number | null;
}

interface RequestTypeAggregateRow extends UsageAggregateRow {
  request_type: string;
}

/**
 * Operator-visible AI usage / cost summary for ONE authorized organization.
 *
 * Read-only observability over the existing `AI_USAGE` telemetry: it never
 * calls the provider, never mutates counters and never touches a business
 * dataset. `organizationId` is ALWAYS the authorized organization resolved by
 * `TenantContextService` — this service performs no authorization of its own
 * and never reads `X-Organization-Id` or a request body.
 *
 * The reported limits come from `AiUsageLimitService.resolveLimits()`, so the
 * operator sees exactly what enforcement applies rather than a second,
 * independently derived opinion.
 */
@Injectable()
export class AiUsageService {
  constructor(
    @InjectRepository(AiUsage)
    private readonly usageRepository: Repository<AiUsage>,
    private readonly aiUsageLimitService: AiUsageLimitService,
    private readonly aiProviderService: AiProviderService,
  ) {}

  async summarize(organizationId: string): Promise<AiUsageResponseDto> {
    const now = new Date();
    const dayWindow = utcDayBounds(now);
    const monthWindow = utcMonthBounds(now);

    const [dayTotals, monthTotals, byRequestType] = await Promise.all([
      this.totals(organizationId, dayWindow),
      this.totals(organizationId, monthWindow),
      this.totalsByRequestType(organizationId, monthWindow),
    ]);

    const limits = this.aiUsageLimitService.resolveLimits();
    const tokensRemaining =
      limits.tokensPerDay > 0 ? Math.max(limits.tokensPerDay - dayTotals.total_tokens, 0) : null;
    const costRemaining =
      limits.monthlyCostUsd > 0
        ? roundUsd(Math.max(limits.monthlyCostUsd - monthTotals.estimated_cost_usd, 0))
        : null;

    return {
      // Server-owned tenant identity: never client input, never the model.
      organization_id: organizationId,
      generated_at: now.toISOString(),
      ai_enabled: this.aiProviderService.isEnabled(),
      day: { label: utcDayKey(now), ...dayTotals },
      month: { label: utcMonthKey(now), ...monthTotals },
      quota: {
        tokens_used_today: dayTotals.total_tokens,
        token_limit_per_day: limits.tokensPerDay,
        tokens_remaining_today: tokensRemaining,
        cost_used_this_month_usd: monthTotals.estimated_cost_usd,
        cost_limit_per_month_usd: limits.monthlyCostUsd,
        cost_remaining_this_month_usd: costRemaining,
      },
      limits: {
        rate_limit_requests_per_minute: limits.requestsPerMinute,
        rate_limit_window_seconds: AI_RATE_LIMIT_WINDOW_SECONDS,
        daily_token_limit: limits.tokensPerDay,
        monthly_cost_limit_usd: limits.monthlyCostUsd,
      },
      by_request_type: byRequestType,
    };
  }

  /**
   * Totals for one UTC window. Every aggregate is filtered on the authorized
   * `organization_id`, so a row from another tenant can never be included.
   */
  private async totals(
    organizationId: string,
    window: TimeWindow,
  ): Promise<Omit<AiUsageWindowDto, 'label'>> {
    const row = await this.usageRepository
      .createQueryBuilder('usage')
      .select('COUNT(*)', 'requests')
      .addSelect(
        'COALESCE(SUM(CASE WHEN usage.success = false THEN 1 ELSE 0 END), 0)',
        'failed_requests',
      )
      .addSelect('COALESCE(SUM(usage.total_tokens), 0)', 'total_tokens')
      .addSelect('COALESCE(SUM(usage.estimated_cost_usd), 0)', 'estimated_cost_usd')
      .where('usage.organization_id = :organizationId', { organizationId })
      .andWhere('usage.created_at >= :start', { start: window.start })
      .andWhere('usage.created_at < :end', { end: window.end })
      .getRawOne<UsageAggregateRow>();

    return toWindow(row);
  }

  /** Month-to-date totals grouped by the server-owned request type. */
  private async totalsByRequestType(
    organizationId: string,
    window: TimeWindow,
  ): Promise<AiUsageRequestTypeDto[]> {
    const rows = await this.usageRepository
      .createQueryBuilder('usage')
      .select('usage.request_type', 'request_type')
      .addSelect('COUNT(*)', 'requests')
      .addSelect(
        'COALESCE(SUM(CASE WHEN usage.success = false THEN 1 ELSE 0 END), 0)',
        'failed_requests',
      )
      .addSelect('COALESCE(SUM(usage.total_tokens), 0)', 'total_tokens')
      .addSelect('COALESCE(SUM(usage.estimated_cost_usd), 0)', 'estimated_cost_usd')
      .where('usage.organization_id = :organizationId', { organizationId })
      .andWhere('usage.created_at >= :start', { start: window.start })
      .andWhere('usage.created_at < :end', { end: window.end })
      .groupBy('usage.request_type')
      .orderBy('usage.request_type', 'ASC')
      .getRawMany<RequestTypeAggregateRow>();

    return (rows ?? []).map((row) => ({
      request_type: String(row.request_type),
      ...toWindow(row),
    }));
  }
}

/** Normalizes raw SQL aggregates (which arrive as strings) into finite numbers. */
function toWindow(row: UsageAggregateRow | undefined): Omit<AiUsageWindowDto, 'label'> {
  return {
    requests: toCounterNumber(row?.requests),
    failed_requests: toCounterNumber(row?.failed_requests),
    total_tokens: toCounterNumber(row?.total_tokens),
    estimated_cost_usd: roundUsd(toCounterNumber(row?.estimated_cost_usd)),
  };
}

/** `AI_USAGE.estimated_cost_usd` is decimal(12,6); report it at that scale. */
function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

