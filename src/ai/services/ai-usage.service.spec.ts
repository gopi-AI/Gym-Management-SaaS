import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiUsage } from '../entities/ai-usage.entity';
import { AiProviderService } from './ai-provider.service';
import { AiUsageLimitService } from './ai-usage-limit.service';
import { AiUsageService } from './ai-usage.service';

/**
 * Organization-scoped operator usage/cost summary.
 *
 * The AI_USAGE ledger is mocked: this spec pins the contract the service owns —
 * every aggregate is scoped to the AUTHORIZED organization, the reported limits
 * are the enforced ones, and disabled limits are reported as "no limit"
 * (null), never as a bogus zero remaining.
 */
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333';
const UNLIMITED = { requestsPerMinute: 0, tokensPerDay: 0, monthlyCostUsd: 0 };
const LIMITED = { requestsPerMinute: 20, tokensPerDay: 200_000, monthlyCostUsd: 25 };

interface FakeQueryBuilder {
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  orderBy: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
  calls: { where: Array<{ sql: string; params: Record<string, unknown> }>; sql: string[] };
}

const buildQueryBuilder = (
  rawOne: Record<string, unknown>,
  rawMany: Array<Record<string, unknown>>,
): FakeQueryBuilder => {
  const builder = {
    calls: {
      where: [] as Array<{ sql: string; params: Record<string, unknown> }>,
      sql: [] as string[],
    },
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    getRawOne: jest.fn().mockResolvedValue(rawOne),
    getRawMany: jest.fn().mockResolvedValue(rawMany),
  };
  builder.select.mockImplementation((sql: string) => {
    builder.calls.sql.push(sql);
    return builder;
  });
  builder.addSelect.mockImplementation((sql: string) => {
    builder.calls.sql.push(sql);
    return builder;
  });
  builder.where.mockImplementation((sql: string, params: Record<string, unknown>) => {
    builder.calls.where.push({ sql, params });
    return builder;
  });
  builder.andWhere.mockImplementation((sql: string, params: Record<string, unknown>) => {
    builder.calls.where.push({ sql, params });
    return builder;
  });
  builder.groupBy.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  return builder as unknown as FakeQueryBuilder;
};

const DAY_ROW = {
  requests: '3',
  failed_requests: '1',
  total_tokens: '1200',
  estimated_cost_usd: '0.012300',
};

describe('AiUsageService', () => {
  let builder: FakeQueryBuilder;
  let limits: { requestsPerMinute: number; tokensPerDay: number; monthlyCostUsd: number };

  const createService = async (
    rawOne: Record<string, unknown> = MONTH_ROW,
    rawMany: Array<Record<string, unknown>> = [],
  ): Promise<AiUsageService> => {
    builder = buildQueryBuilder(rawOne, rawMany);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AiUsageService,
        {
          provide: getRepositoryToken(AiUsage),
          useValue: { createQueryBuilder: jest.fn(() => builder) },
        },
        {
          provide: AiUsageLimitService,
          useValue: { resolveLimits: jest.fn(() => limits) },
        },
        { provide: AiProviderService, useValue: { isEnabled: jest.fn(() => true) } },
      ],
    }).compile();
    return moduleRef.get<AiUsageService>(AiUsageService);
  };

  beforeEach(() => {
    limits = { ...LIMITED };
  });

  it('scopes every aggregate to the AUTHORIZED organization only', async () => {
    const service = await createService();

    await service.summarize(ORG_ID);

    const orgFilters = builder.calls.where.filter((call) => 'organizationId' in call.params);
    expect(orgFilters).toHaveLength(3);
    for (const call of orgFilters) {
      expect(call.sql).toContain('organization_id');
      expect(call.params.organizationId).toBe(ORG_ID);
    }
    expect(JSON.stringify(builder.calls.where)).not.toContain(OTHER_ORG_ID);
  });

  it('windows the day/month totals on deterministic UTC bounds', async () => {
    const service = await createService();
    const now = new Date();

    await service.summarize(ORG_ID);

    const windowFilters = builder.calls.where.filter(
      (call) => 'start' in call.params || 'end' in call.params,
    );
    // three aggregate queries, each bounded with a half-open [start, end) range
    expect(windowFilters).toHaveLength(6);
    for (const call of windowFilters) {
      expect(call.sql).toContain('created_at');
      const bound = ('start' in call.params ? call.params.start : call.params.end) as Date;
      expect(bound).toBeInstanceOf(Date);
    }

    const dayStart = builder.calls.where.find((call) => 'start' in call.params)?.params.start as Date;
    expect(dayStart.getUTCHours()).toBe(0);
    expect(dayStart.getUTCMinutes()).toBe(0);
    expect(dayStart.getTime()).toBe(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  });

  it('normalizes string aggregates into finite numbers at the column scale', async () => {
    const service = await createService(DAY_ROW, []);

    const result = await service.summarize(ORG_ID);

    expect(result.day.requests).toBe(3);
    expect(result.day.failed_requests).toBe(1);
    expect(result.day.total_tokens).toBe(1200);
    expect(result.day.estimated_cost_usd).toBe(0.0123);
  });

  it('reports the limits that are actually enforced, plus remaining budget', async () => {
    const service = await createService(DAY_ROW, []);

    const result = await service.summarize(ORG_ID);

    expect(result.limits).toEqual({
      rate_limit_requests_per_minute: 20,
      rate_limit_window_seconds: 60,
      daily_token_limit: 200_000,
      monthly_cost_limit_usd: 25,
    });
    expect(result.quota.tokens_used_today).toBe(1200);
    expect(result.quota.tokens_remaining_today).toBe(198_800);
    expect(result.quota.cost_used_this_month_usd).toBe(0.0123);
    expect(result.quota.cost_remaining_this_month_usd).toBe(24.9877);
  });

  it('reports a disabled limit as "no limit" (null), never as zero remaining', async () => {
    limits = { ...UNLIMITED };
    const service = await createService(DAY_ROW, []);

    const result = await service.summarize(ORG_ID);

    expect(result.quota.tokens_remaining_today).toBeNull();
    expect(result.quota.cost_remaining_this_month_usd).toBeNull();
    expect(result.limits.daily_token_limit).toBe(0);
    expect(result.limits.monthly_cost_limit_usd).toBe(0);
  });

  it('never reports more remaining budget than the limit allows', async () => {
    const service = await createService({
      requests: '1',
      failed_requests: '0',
      total_tokens: '999999999',
      estimated_cost_usd: '9999',
    });

    const result = await service.summarize(ORG_ID);

    expect(result.quota.tokens_remaining_today).toBe(0);
    expect(result.quota.cost_remaining_this_month_usd).toBe(0);
  });

  it('exposes the server-owned tenant and per-request-type breakdown, and nothing else', async () => {
    const service = await createService(MONTH_ROW, [
      { ...DAY_ROW, request_type: 'retention-analysis' },
      { ...MONTH_ROW, request_type: 'plan-performance-analysis' },
    ]);

    const result = await service.summarize(ORG_ID);

    expect(result.organization_id).toBe(ORG_ID);
    expect(result.ai_enabled).toBe(true);
    expect(result.generated_at).toBe(new Date(result.generated_at).toISOString());
    expect(result.by_request_type).toEqual([
      {
        request_type: 'retention-analysis',
        requests: 3,
        failed_requests: 1,
        total_tokens: 1200,
        estimated_cost_usd: 0.0123,
      },
      {
        request_type: 'plan-performance-analysis',
        requests: 10,
        failed_requests: 2,
        total_tokens: 5000,
        estimated_cost_usd: 0.123456,
      },
    ]);
    expect(Object.keys(result).sort()).toEqual([
      'ai_enabled',
      'by_request_type',
      'day',
      'generated_at',
      'limits',
      'month',
      'organization_id',
      'quota',
    ]);
  });

  it('appends the UTC day/month labels used for the windows', async () => {
    const service = await createService();
    const now = new Date();

    const result = await service.summarize(ORG_ID);

    expect(result.day.label).toBe(now.toISOString().slice(0, 10));
    expect(result.month.label).toBe(now.toISOString().slice(0, 7));
  });
});

const MONTH_ROW = {
  requests: '10',
  failed_requests: '2',
  total_tokens: '5000',
  estimated_cost_usd: '0.123456',
};
