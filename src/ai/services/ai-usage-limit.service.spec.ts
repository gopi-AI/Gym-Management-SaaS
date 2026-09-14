import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiUsage } from '../entities/ai-usage.entity';
import { AiProviderService } from './ai-provider.service';
import { AI_REQUEST_TYPE_RETENTION } from './ai.service';
import {
  AI_COST_BUDGET_EXCEEDED_MESSAGE,
  AI_RATE_LIMIT_EXCEEDED_MESSAGE,
  AI_TOKEN_BUDGET_EXCEEDED_MESSAGE,
  AiUsageLimitService,
} from './ai-usage-limit.service';
import { utcDayKey, utcMonthKey } from '../config/ai-usage-limits';

/**
 * Rate limiting, token budget and cost budget tests.
 *
 * Redis is replaced by an in-memory fake that implements exactly the commands
 * the service uses (GET / SET NX EX / INCR / INCRBY / INCRBYFLOAT / EXPIRE) and
 * the AI_USAGE repository is mocked: no Redis, no database, no provider.
 */
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '33333333-3333-4333-8333-333333333333';
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '44444444-4444-4444-8444-444444444444';
const REQUEST_TYPE = AI_REQUEST_TYPE_RETENTION;
const OTHER_REQUEST_TYPE = 'other-analysis';

interface RecordedCall {
  command: string;
  key: string;
  args: unknown[];
}

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly expirations = new Map<string, number>();
  readonly calls: RecordedCall[] = [];
  failure: Error | null = null;

  async get(key: string): Promise<string | null> {
    this.record('get', key);
    this.throwIfFailing();
    return this.values.has(key) ? (this.values.get(key) as string) : null;
  }

  async set(
    key: string,
    value: string,
    options?: { NX?: boolean; EX?: number },
  ): Promise<unknown> {
    this.record('set', key, options);
    this.throwIfFailing();
    if (options?.NX && this.values.has(key)) {
      return null;
    }
    this.values.set(key, String(value));
    if (options?.EX) {
      this.expirations.set(key, options.EX);
    }
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    return this.incrBy(key, 1);
  }

  async incrBy(key: string, increment: number): Promise<number> {
    this.record('incrBy', key, increment);
    this.throwIfFailing();
    const next = Number(this.values.get(key) ?? '0') + increment;
    this.values.set(key, String(next));
    return next;
  }

  async incrByFloat(key: string, increment: number): Promise<number | string> {
    this.record('incrByFloat', key, increment);
    this.throwIfFailing();
    const next = Number(this.values.get(key) ?? '0') + increment;
    this.values.set(key, String(next));
    return next;
  }

  async expire(key: string, seconds: number): Promise<unknown> {
    this.record('expire', key, seconds);
    this.throwIfFailing();
    this.expirations.set(key, seconds);
    return 1;
  }

  commandsFor(command: string): RecordedCall[] {
    return this.calls.filter((call) => call.command === command);
  }

  private throwIfFailing(): void {
    if (this.failure) {
      throw this.failure;
    }
  }

  private record(command: string, key: string, ...args: unknown[]): void {
    this.calls.push({ command, key, args });
  }
}

interface FakeQueryBuilder {
  select: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getRawOne: jest.Mock;
}

const buildQueryBuilder = (total: string | number): FakeQueryBuilder => {
  const builder: FakeQueryBuilder = {
    select: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    getRawOne: jest.fn().mockResolvedValue({ total }),
  };
  builder.select.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  return builder;
};

const expectHttpStatus = async (promise: Promise<unknown>, status: number): Promise<HttpException> => {
  let caught: unknown;
  await promise.catch((error) => {
    caught = error;
  });
  expect(caught).toBeInstanceOf(HttpException);
  const httpError = caught as HttpException;
  expect(httpError.getStatus()).toBe(status);
  return httpError;
};

describe('AiUsageLimitService', () => {
  let redis: FakeRedis;
  let usageRepository: { createQueryBuilder: jest.Mock };
  let aiProviderService: { isEnabled: jest.Mock };

  const DEFAULT_CONFIG: Record<string, string> = {
    AI_RATE_LIMIT_RPM: '5',
    AI_RATE_LIMIT_TPD: '1000',
    AI_COST_LIMIT_MONTHLY_USD: '10',
  };

  const createService = async (
    overrides: Record<string, string> = {},
    client: unknown = redis,
  ): Promise<AiUsageLimitService> => {
    const values = { ...DEFAULT_CONFIG, ...overrides };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AiUsageLimitService,
        { provide: CACHE_MANAGER, useValue: { store: { client } } },
        { provide: getRepositoryToken(AiUsage), useValue: usageRepository },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => values[key]) },
        },
        { provide: AiProviderService, useValue: aiProviderService },
      ],
    }).compile();
    return moduleRef.get<AiUsageLimitService>(AiUsageLimitService);
  };

  const context = (organizationId = ORG_A, userId = USER_A, requestType = REQUEST_TYPE) => ({
    organizationId,
    userId,
    requestType,
  });

  beforeEach(() => {
    redis = new FakeRedis();
    usageRepository = { createQueryBuilder: jest.fn(() => buildQueryBuilder(0)) };
    aiProviderService = { isEnabled: jest.fn().mockReturnValue(true) };
  });

  describe('request rate limiting', () => {
    it('allows requests below and at the limit, and rejects the one above it with 429', async () => {
      const service = await createService({ AI_RATE_LIMIT_RPM: '3' });
      const ctx = context();

      await expect(service.assertRequestAllowed(ctx)).resolves.toBeUndefined();
      await expect(service.assertRequestAllowed(ctx)).resolves.toBeUndefined();
      await expect(service.assertRequestAllowed(ctx)).resolves.toBeUndefined();

      const error = await expectHttpStatus(service.assertRequestAllowed(ctx), 429);
      expect(error.message).toBe(AI_RATE_LIMIT_EXCEEDED_MESSAGE);
      expect(error.message).not.toMatch(/redis|incr|expire|ai:ratelimit/i);
    });

    it('uses an atomic fixed-window counter that expires with the window', async () => {
      const service = await createService({ AI_RATE_LIMIT_RPM: '2' });
      const key = `ai:ratelimit:${ORG_A}:${USER_A}:${REQUEST_TYPE}`;

      await service.assertRequestAllowed(context());
      await service.assertRequestAllowed(context());

      const increments = redis.commandsFor('incrBy').filter((call) => call.key === key);
      expect(increments).toHaveLength(2);
      expect(increments[0].args).toEqual([1]);
      expect(redis.expirations.get(key)).toBe(60);
      // EXPIRE is applied once, when the window is created (fixed, not sliding).
      expect(redis.commandsFor('expire').filter((call) => call.key === key)).toHaveLength(1);
    });

    it('isolates counters per user inside the same organization', async () => {
      const service = await createService({ AI_RATE_LIMIT_RPM: '2' });

      await service.assertRequestAllowed(context(ORG_A, USER_A));
      await service.assertRequestAllowed(context(ORG_A, USER_A));
      await expectHttpStatus(service.assertRequestAllowed(context(ORG_A, USER_A)), 429);

      // A second user of the SAME organization keeps their own budget.
      await expect(
        service.assertRequestAllowed(context(ORG_A, USER_B)),
      ).resolves.toBeUndefined();
      expect(redis.values.get(`ai:ratelimit:${ORG_A}:${USER_B}:${REQUEST_TYPE}`)).toBe('1');
    });

    it('isolates counters per organization for the same authenticated user', async () => {
      const service = await createService({ AI_RATE_LIMIT_RPM: '2' });

      await service.assertRequestAllowed(context(ORG_A, USER_A));
      await service.assertRequestAllowed(context(ORG_A, USER_A));
      await expectHttpStatus(service.assertRequestAllowed(context(ORG_A, USER_A)), 429);

      await expect(
        service.assertRequestAllowed(context(ORG_B, USER_A)),
      ).resolves.toBeUndefined();
      expect(redis.values.get(`ai:ratelimit:${ORG_B}:${USER_A}:${REQUEST_TYPE}`)).toBe('1');
    });

    it('isolates counters per request type', async () => {
      const service = await createService({ AI_RATE_LIMIT_RPM: '1' });

      await service.assertRequestAllowed(context(ORG_A, USER_A, REQUEST_TYPE));
      await expectHttpStatus(
        service.assertRequestAllowed(context(ORG_A, USER_A, REQUEST_TYPE)),
        429,
      );

      await expect(
        service.assertRequestAllowed(context(ORG_A, USER_A, OTHER_REQUEST_TYPE)),
      ).resolves.toBeUndefined();
    });
  });

  describe('daily token budget', () => {
    const TOKEN_ONLY = { AI_RATE_LIMIT_RPM: '0', AI_RATE_LIMIT_TPD: '100', AI_COST_LIMIT_MONTHLY_USD: '0' };

    it('allows a request while the organization is below its token budget', async () => {
      usageRepository.createQueryBuilder.mockReturnValueOnce(buildQueryBuilder(10));
      const service = await createService(TOKEN_ONLY);

      await expect(service.assertRequestAllowed(context())).resolves.toBeUndefined();

      const query = usageRepository.createQueryBuilder.mock.results[0].value as FakeQueryBuilder;
      expect(query.where).toHaveBeenCalledWith('usage.organization_id = :organizationId', {
        organizationId: ORG_A,
      });
      expect(query.andWhere).toHaveBeenCalledWith('usage.created_at >= :start', {
        start: expect.any(Date),
      });
      expect(query.andWhere).toHaveBeenCalledWith('usage.created_at < :end', {
        end: expect.any(Date),
      });

      const budgetKey = redis.calls.find((call) => call.key.startsWith('ai:budget:'))?.key;
      expect(budgetKey).toBe(`ai:budget:${ORG_A}:${utcDayKey(new Date())}`);
      // Hydrated from the durable ledger with SET NX and a window-aligned TTL.
      expect(redis.values.get(budgetKey as string)).toBe('10');
      expect(redis.expirations.get(budgetKey as string)).toBeGreaterThan(0);
      expect(redis.expirations.get(budgetKey as string)).toBeLessThanOrEqual(86_400);
    });

    it('blocks with 429 once the organization has reached its token budget', async () => {
      usageRepository.createQueryBuilder.mockReturnValueOnce(buildQueryBuilder(100));
      const service = await createService(TOKEN_ONLY);

      const error = await expectHttpStatus(service.assertRequestAllowed(context()), 429);
      expect(error.message).toBe(AI_TOKEN_BUDGET_EXCEEDED_MESSAGE);
      expect(error.message).not.toMatch(/redis|incr|ai:budget|token count/i);
    });

    it('keeps the daily token budget independent per organization', async () => {
      usageRepository.createQueryBuilder
        .mockReturnValueOnce(buildQueryBuilder(100))
        .mockReturnValueOnce(buildQueryBuilder(0));
      const service = await createService(TOKEN_ONLY);

      await expectHttpStatus(service.assertRequestAllowed(context(ORG_A, USER_A)), 429);
      await expect(service.assertRequestAllowed(context(ORG_B, USER_A))).resolves.toBeUndefined();
    });

    it('trusts the cached counter and does not re-read AI_USAGE while it is warm', async () => {
      const service = await createService(TOKEN_ONLY);
      const budgetKey = `ai:budget:${ORG_A}:${utcDayKey(new Date())}`;
      redis.values.set(budgetKey, '100');

      await expectHttpStatus(service.assertRequestAllowed(context()), 429);
      expect(usageRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('adds the provider-reported tokens of a completed call exactly once', async () => {
      const service = await createService(TOKEN_ONLY);

      await service.recordUsage({ organizationId: ORG_A, totalTokens: 42, estimatedCostUsd: null });

      const budgetKey = `ai:budget:${ORG_A}:${utcDayKey(new Date())}`;
      expect(redis.values.get(budgetKey)).toBe('42');
      expect(redis.expirations.get(budgetKey)).toBeGreaterThan(0);
      expect(redis.expirations.get(budgetKey)).toBeLessThanOrEqual(86_400);
      expect(redis.commandsFor('incrBy').filter((call) => call.key === budgetKey)).toHaveLength(1);
    });

    it('never consumes budget for a call that reported no tokens', async () => {
      const service = await createService(TOKEN_ONLY);

      await service.recordUsage({ organizationId: ORG_A, totalTokens: 0, estimatedCostUsd: null });
      await service.recordUsage({ organizationId: ORG_A, totalTokens: 0, estimatedCostUsd: '0.000000' });

      expect(redis.calls).toHaveLength(0);
      expect(redis.values.size).toBe(0);
    });
  });

  describe('monthly cost budget', () => {
    const COST_ONLY = { AI_RATE_LIMIT_RPM: '0', AI_RATE_LIMIT_TPD: '0', AI_COST_LIMIT_MONTHLY_USD: '10' };

    it('allows a request while the organization is below its monthly cost budget', async () => {
      usageRepository.createQueryBuilder.mockReturnValueOnce(buildQueryBuilder('1.500000'));
      const service = await createService(COST_ONLY);

      await expect(service.assertRequestAllowed(context())).resolves.toBeUndefined();

      const query = usageRepository.createQueryBuilder.mock.results[0].value as FakeQueryBuilder;
      expect(query.select).toHaveBeenCalledWith('COALESCE(SUM(usage.estimated_cost_usd), 0)', 'total');
      expect(query.where).toHaveBeenCalledWith('usage.organization_id = :organizationId', {
        organizationId: ORG_A,
      });
      const costKey = redis.calls.find((call) => call.key.startsWith('ai:cost:'))?.key;
      expect(costKey).toBe(`ai:cost:${ORG_A}:${utcMonthKey(new Date())}`);
      expect(redis.expirations.get(costKey as string)).toBeLessThanOrEqual(31 * 86_400);
    });

    it('blocks with 429 once the organization has reached its monthly cost budget', async () => {
      usageRepository.createQueryBuilder.mockReturnValueOnce(buildQueryBuilder('10.000000'));
      const service = await createService(COST_ONLY);

      const error = await expectHttpStatus(service.assertRequestAllowed(context()), 429);
      expect(error.message).toBe(AI_COST_BUDGET_EXCEEDED_MESSAGE);
      expect(error.message).not.toMatch(/redis|incr|ai:cost|usd\s*=\s*10/i);
    });

    it('keeps the monthly cost budget independent per organization', async () => {
      usageRepository.createQueryBuilder
        .mockReturnValueOnce(buildQueryBuilder('10.000000'))
        .mockReturnValueOnce(buildQueryBuilder('0'));
      const service = await createService(COST_ONLY);

      await expectHttpStatus(service.assertRequestAllowed(context(ORG_A, USER_A)), 429);
      await expect(service.assertRequestAllowed(context(ORG_B, USER_A))).resolves.toBeUndefined();
    });

    it('trusts the cached cost counter and does not re-read AI_USAGE while it is warm', async () => {
      const service = await createService(COST_ONLY);
      redis.values.set(`ai:cost:${ORG_A}:${utcMonthKey(new Date())}`, '10');

      await expectHttpStatus(service.assertRequestAllowed(context()), 429);
      expect(usageRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('adds the already-persisted, server-computed cost exactly once', async () => {
      const service = await createService(COST_ONLY);

      await service.recordUsage({
        organizationId: ORG_A,
        totalTokens: 0,
        estimatedCostUsd: '2.500000',
      });

      const costKey = `ai:cost:${ORG_A}:${utcMonthKey(new Date())}`;
      expect(redis.values.get(costKey)).toBe('2.5');
      const flushes = redis.commandsFor('incrByFloat').filter((call) => call.key === costKey);
      expect(flushes).toHaveLength(1);
      expect(flushes[0].args).toEqual([2.5]);
      expect(redis.expirations.get(costKey)).toBeLessThanOrEqual(31 * 86_400);
    });

    it('records nothing for a failed call that produced no cost', async () => {
      const service = await createService(COST_ONLY);

      await service.recordUsage({ organizationId: ORG_A, totalTokens: 0, estimatedCostUsd: null });
      await service.recordUsage({ organizationId: ORG_A, totalTokens: 0, estimatedCostUsd: '0.000000' });

      expect(redis.calls).toHaveLength(0);
    });
  });

  describe('Redis availability (fail closed)', () => {
    it('rejects with 503 instead of allowing an unmetered request when Redis is down', async () => {
      const service = await createService({
        AI_RATE_LIMIT_RPM: '0',
        AI_RATE_LIMIT_TPD: '100',
        AI_COST_LIMIT_MONTHLY_USD: '0',
      });
      redis.failure = new Error('READONLY You cannot write against a read only replica.');

      const error = await expectHttpStatus(service.assertRequestAllowed(context()), 503);
      expect(error.message).not.toContain('READONLY');
      expect(usageRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('rejects with 503 when the shared cache exposes no counter client', async () => {
      const service = await createService(DEFAULT_CONFIG, null);

      const error = await expectHttpStatus(service.assertRequestAllowed(context()), 503);
      expect(error.message).not.toMatch(/redis|client/i);
    });

    it('does not fail an already-completed provider call when counters cannot be updated', async () => {
      const service = await createService(DEFAULT_CONFIG);
      redis.failure = new Error('connection reset by peer');

      await expect(
        service.recordUsage({ organizationId: ORG_A, totalTokens: 10, estimatedCostUsd: '0.5' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('kill-switch and tenant scoping', () => {
    it('does not touch counters, budgets or AI_USAGE while AI is disabled', async () => {
      aiProviderService.isEnabled.mockReturnValue(false);
      const service = await createService(DEFAULT_CONFIG);

      await expect(service.assertRequestAllowed(context())).resolves.toBeUndefined();
      await service.recordUsage({ organizationId: ORG_A, totalTokens: 10, estimatedCostUsd: '1' });

      expect(redis.calls).toHaveLength(0);
      expect(usageRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('derives every counter key from the authorized organization that was passed in', async () => {
      const service = await createService({ AI_RATE_LIMIT_RPM: '5' });

      await service.assertRequestAllowed(context(ORG_B, USER_B));

      const keys = redis.calls.map((call) => call.key);
      expect(keys).toContain(`ai:ratelimit:${ORG_B}:${USER_B}:${REQUEST_TYPE}`);
      expect(keys.every((key) => !key.includes(ORG_A))).toBe(true);
    });
  });
});
