import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import { AiUsage } from '../entities/ai-usage.entity';
import { AiProviderService } from './ai-provider.service';
import {
  AI_COST_LIMIT_MAX_MONTHLY_USD,
  AI_RATE_LIMIT_MAX_RPM,
  AI_RATE_LIMIT_MAX_TPD,
  AI_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_AI_COST_LIMIT_MONTHLY_USD,
  DEFAULT_AI_RATE_LIMIT_RPM,
  DEFAULT_AI_RATE_LIMIT_TPD,
  AiUsageLimits,
  TimeWindow,
  buildDailyTokenBudgetKey,
  buildMonthlyCostBudgetKey,
  buildRateLimitKey,
  resolveAiLimit,
  secondsUntil,
  toCounterNumber,
  utcDayBounds,
  utcDayKey,
  utcMonthBounds,
  utcMonthKey,
} from '../config/ai-usage-limits';

/**
 * Minimal structural view of the SHARED Redis client that backs the global
 * cache (`CACHE_MANAGER` → `cache-manager-redis-yet` → node-redis).
 *
 * Reusing this connection keeps the "one Redis provider" invariant: no second
 * client, pool, module or dependency is introduced for rate limiting.
 */
interface AiCounterClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { NX?: boolean; EX?: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  incrBy(key: string, increment: number): Promise<number>;
  incrByFloat(key: string, increment: number): Promise<number | string>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const COUNTER_METHODS: Array<keyof AiCounterClient> = [
  'get',
  'set',
  'incr',
  'incrBy',
  'incrByFloat',
  'expire',
];

/**
 * Client-safe 429 messages. They name the exhausted business limit only —
 * never Redis, never key names, never counters, credentials or tenant data.
 */
export const AI_RATE_LIMIT_EXCEEDED_MESSAGE =
  'AI request rate limit exceeded for this organization member; please retry later';
export const AI_TOKEN_BUDGET_EXCEEDED_MESSAGE =
  'The AI daily token budget for this organization has been reached; request rejected';
export const AI_COST_BUDGET_EXCEEDED_MESSAGE =
  'The AI monthly cost budget for this organization has been reached; request rejected';
const AI_LIMITER_UNAVAILABLE_MESSAGE =
  'AI usage limits could not be verified; the request was rejected';

export interface AiRequestLimitContext {
  /** Authorized organization (TenantContextService result — never client input). */
  organizationId: string;
  /** Authenticated user id (verified JWT — never client input). */
  userId: string;
  /** Server-owned request type, e.g. `retention-analysis`. */
  requestType: string;
}

export interface AiUsageRecording {
  organizationId: string;
  /** Provider-reported token usage for the call that just completed. */
  totalTokens: number;
  /** Server-computed cost as persisted on `AI_USAGE.estimated_cost_usd`. */
  estimatedCostUsd: string | number | null;
}

/**
 * Rate limiting and cost control for AI requests.
 *
 * Design:
 * - Redis (the shared cache connection) holds fast, atomic counters;
 * - PostgreSQL `AI_USAGE` is the durable source of truth. A counter that is
 *   unknown (first request of the window, eviction, Redis restart) is
 *   re-hydrated from `AI_USAGE` with `SET NX`, so a lost counter can never
 *   hand out a fresh budget;
 * - windows are deterministic UTC calendar windows and every counter is given
 *   an expiration that ends exactly with its window;
 * - Redis failure is FAIL CLOSED: a request whose limits cannot be verified is
 *   rejected with 503, never allowed through unmetered.
 *
 * This service deliberately knows nothing about any specific AI capability.
 */
@Injectable()
export class AiUsageLimitService {
  private readonly logger = new Logger(AiUsageLimitService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectRepository(AiUsage)
    private readonly usageRepository: Repository<AiUsage>,
    private readonly config: ConfigService,
    private readonly aiProviderService: AiProviderService,
  ) {}

  /**
   * Adds the provider-reported usage of a completed call to the fast counters.
   *
   * Called exactly once per provider call by `AiService` (whether the response
   * was usable or not), so a call is never counted twice. Zero-usage failures
   * write nothing, so a failed provider call cannot invent token usage.
   *
   * Best effort: the provider call already happened and the durable `AI_USAGE`
   * record is written separately, so a counter hiccup must not fail the request.
   */
  async recordUsage(usage: AiUsageRecording): Promise<void> {
    if (!this.aiProviderService.isEnabled()) {
      return;
    }

    const tokens = toCounterNumber(usage.totalTokens);
    const cost = toCounterNumber(usage.estimatedCostUsd);
    if (tokens <= 0 && cost <= 0) {
      return;
    }

    const limits = this.resolveLimits();
    const now = new Date();

    try {
      const client = this.counterClient();
      if (!client) {
        this.logger.error(
          `AI usage counters are unavailable; organization ${usage.organizationId} usage was recorded in AI_USAGE only`,
        );
        return;
      }

      if (tokens > 0 && limits.tokensPerDay > 0) {
        const window = utcDayBounds(now);
        const key = buildDailyTokenBudgetKey(usage.organizationId, utcDayKey(now));
        await client.incrBy(key, tokens);
        // The window end is fixed, so re-expiring can only align the TTL with
        // the current UTC day — it can never extend the window.
        await client.expire(key, secondsUntil(window.end, now));
      }

      if (cost > 0 && limits.monthlyCostUsd > 0) {
        const window = utcMonthBounds(now);
        const key = buildMonthlyCostBudgetKey(usage.organizationId, utcMonthKey(now));
        await client.incrByFloat(key, cost);
        await client.expire(key, secondsUntil(window.end, now));
      }
    } catch (error) {
      this.logger.error(
        `AI usage counters could not be updated for organization ${usage.organizationId}: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Enforces every configured AI limit for one request.
   *
   * Must be called AFTER authentication, organization authorization and the AI
   * permission check, and BEFORE any business dataset is read or the provider
   * is called.
   *
   * @throws HttpException 429 when a limit is exhausted
   * @throws ServiceUnavailableException 503 when limits cannot be verified
   */
  async assertRequestAllowed(context: AiRequestLimitContext): Promise<void> {
    // A disabled deployment is not "rate limited": the request must keep
    // flowing through so the existing 503 kill-switch semantics are preserved.
    if (!this.aiProviderService.isEnabled()) {
      return;
    }

    const limits = this.resolveLimits();
    const now = new Date();

    try {
      const client = this.requireCounterClient();

      if (limits.requestsPerMinute > 0) {
        const key = buildRateLimitKey(context.organizationId, context.userId, context.requestType);
        // INCR-then-check is atomic, so concurrent requests cannot slip past a
        // non-atomic read/modify/write pair. Over-limit requests keep counting
        // inside the same fixed window (stricter, never more permissive).
        const count = await client.incr(key);
        if (count === 1) {
          await client.expire(key, AI_RATE_LIMIT_WINDOW_SECONDS);
        }
        if (count > limits.requestsPerMinute) {
          throw new HttpException(AI_RATE_LIMIT_EXCEEDED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
      }

      if (limits.tokensPerDay > 0) {
        const used = await this.readDailyTokens(client, context.organizationId, now);
        if (used >= limits.tokensPerDay) {
          throw new HttpException(AI_TOKEN_BUDGET_EXCEEDED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
      }

      if (limits.monthlyCostUsd > 0) {
        const spent = await this.readMonthlyCost(client, context.organizationId, now);
        if (spent >= limits.monthlyCostUsd) {
          throw new HttpException(AI_COST_BUDGET_EXCEEDED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `AI usage limit check failed for organization ${context.organizationId} (failing closed): ${errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(AI_LIMITER_UNAVAILABLE_MESSAGE);
    }
  }

  // ---------------------------------------------------------------------------
  // Limits / counters
  // ---------------------------------------------------------------------------

  /**
   * The currently configured limits.
   *
   * Public so that the operator usage view can report EXACTLY the limits this
   * service enforces instead of re-deriving them — a display that disagreed
   * with enforcement would be worse than no display at all. Still read-only:
   * nothing but `assertRequestAllowed` decides whether a request proceeds.
   */
  resolveLimits(): AiUsageLimits {
    return {
      requestsPerMinute: Math.floor(
        resolveAiLimit(
          this.config.get<string>('AI_RATE_LIMIT_RPM'),
          DEFAULT_AI_RATE_LIMIT_RPM,
          0,
          AI_RATE_LIMIT_MAX_RPM,
        ),
      ),
      tokensPerDay: Math.floor(
        resolveAiLimit(
          this.config.get<string>('AI_RATE_LIMIT_TPD'),
          DEFAULT_AI_RATE_LIMIT_TPD,
          0,
          AI_RATE_LIMIT_MAX_TPD,
        ),
      ),
      monthlyCostUsd: resolveAiLimit(
        this.config.get<string>('AI_COST_LIMIT_MONTHLY_USD'),
        DEFAULT_AI_COST_LIMIT_MONTHLY_USD,
        0,
        AI_COST_LIMIT_MAX_MONTHLY_USD,
      ),
    };
  }

  private async readDailyTokens(
    client: AiCounterClient,
    organizationId: string,
    now: Date,
  ): Promise<number> {
    const window = utcDayBounds(now);
    const key = buildDailyTokenBudgetKey(organizationId, utcDayKey(now));
    return this.readBudgetCounter(
      client,
      key,
      () => this.sumTokens(organizationId, window),
      secondsUntil(window.end, now),
    );
  }

  private async readMonthlyCost(
    client: AiCounterClient,
    organizationId: string,
    now: Date,
  ): Promise<number> {
    const window = utcMonthBounds(now);
    const key = buildMonthlyCostBudgetKey(organizationId, utcMonthKey(now));
    return this.readBudgetCounter(
      client,
      key,
      () => this.sumCost(organizationId, window),
      secondsUntil(window.end, now),
    );
  }

  /**
   * Reads a budget counter, hydrating it from the durable `AI_USAGE` ledger on
   * a miss. `SET NX` means a concurrent request can never overwrite a counter
   * that a peer has already advanced.
   */
  private async readBudgetCounter(
    client: AiCounterClient,
    key: string,
    hydrate: () => Promise<number>,
    ttlSeconds: number,
  ): Promise<number> {
    const raw = await client.get(key);
    if (raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    const hydrated = await hydrate();
    await client.set(key, String(hydrated), { NX: true, EX: Math.max(Math.floor(ttlSeconds), 1) });

    const stored = await client.get(key);
    if (stored !== null && stored !== undefined) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    return hydrated;
  }

  /**
   * Durable per-organization token usage for the window.
   *
   * All `AI_USAGE` rows count, including failures that reported real provider
   * usage: those tokens were consumed upstream regardless of whether the model
   * output was usable.
   */
  private async sumTokens(organizationId: string, window: TimeWindow): Promise<number> {
    const raw = await this.usageRepository
      .createQueryBuilder('usage')
      .select('COALESCE(SUM(usage.total_tokens), 0)', 'total')
      .where('usage.organization_id = :organizationId', { organizationId })
      .andWhere('usage.created_at >= :start', { start: window.start })
      .andWhere('usage.created_at < :end', { end: window.end })
      .getRawOne<{ total: string | number | null }>();
    return toCounterNumber(raw?.total);
  }

  /**
   * Durable per-organization estimated cost for the window, taken from the
   * server-computed `estimated_cost_usd` column (unpriced models are `NULL` and
   * therefore add nothing).
   */
  private async sumCost(organizationId: string, window: TimeWindow): Promise<number> {
    const raw = await this.usageRepository
      .createQueryBuilder('usage')
      .select('COALESCE(SUM(usage.estimated_cost_usd), 0)', 'total')
      .where('usage.organization_id = :organizationId', { organizationId })
      .andWhere('usage.created_at >= :start', { start: window.start })
      .andWhere('usage.created_at < :end', { end: window.end })
      .getRawOne<{ total: string | number | null }>();
    return toCounterNumber(raw?.total);
  }

  // ---------------------------------------------------------------------------
  // Redis access (shared cache connection only)
  // ---------------------------------------------------------------------------

  private counterClient(): AiCounterClient | null {
    const store = (this.cacheManager as unknown as { store?: { client?: unknown } }).store;
    const client = store?.client as Partial<AiCounterClient> | undefined;
    if (!client) {
      return null;
    }
    const complete = COUNTER_METHODS.every((method) => typeof client[method] === 'function');
    return complete ? (client as AiCounterClient) : null;
  }

  private requireCounterClient(): AiCounterClient {
    const client = this.counterClient();
    if (!client) {
      throw new ServiceUnavailableException(AI_LIMITER_UNAVAILABLE_MESSAGE);
    }
    return client;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
