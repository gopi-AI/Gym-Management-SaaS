import {
  AI_RATE_LIMIT_WINDOW_SECONDS,
  buildDailyTokenBudgetKey,
  buildMonthlyCostBudgetKey,
  buildRateLimitKey,
  resolveAiLimit,
  sanitizeKeySegment,
  secondsUntil,
  toCounterNumber,
  utcDayBounds,
  utcDayKey,
  utcMonthBounds,
  utcMonthKey,
} from './ai-usage-limits';
import { estimateCostUsd, isModelPriced } from './ai-pricing';

/**
 * Pure configuration/key/window rules behind AI rate limiting and budgets.
 * No Redis, no database, no provider.
 */
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('ai-usage-limits configuration', () => {
  describe('resolveAiLimit', () => {
    it('falls back for a missing or unparsable value instead of going unlimited', () => {
      expect(resolveAiLimit(undefined, 20, 0, 1000)).toBe(20);
      expect(resolveAiLimit('', 20, 0, 1000)).toBe(20);
      expect(resolveAiLimit('   ', 20, 0, 1000)).toBe(20);
      expect(resolveAiLimit('not-a-number', 20, 0, 1000)).toBe(20);
      expect(resolveAiLimit('Infinity', 20, 0, 1000)).toBe(20);
    });

    it('clamps into the configured bounds and preserves an explicit 0 (disabled)', () => {
      expect(resolveAiLimit('-5', 20, 0, 1000)).toBe(0);
      expect(resolveAiLimit('0', 20, 0, 1000)).toBe(0);
      expect(resolveAiLimit('50', 20, 0, 1000)).toBe(50);
      expect(resolveAiLimit('999999', 20, 0, 1000)).toBe(1000);
      expect(resolveAiLimit('2.5', 20, 0, 1000)).toBe(2.5);
    });
  });

  describe('Redis keys', () => {
    it('scopes the rate-limit key to organization + user + request type', () => {
      expect(buildRateLimitKey(ORG_ID, USER_ID, 'retention-analysis')).toBe(
        `ai:ratelimit:${ORG_ID}:${USER_ID}:retention-analysis`,
      );
    });

    it('never shares a counter across organizations, users or request types', () => {
      const base = buildRateLimitKey(ORG_ID, USER_ID, 'retention-analysis');
      expect(buildRateLimitKey(OTHER_ORG_ID, USER_ID, 'retention-analysis')).not.toBe(base);
      expect(
        buildRateLimitKey(ORG_ID, '99999999-9999-4999-8999-999999999999', 'retention-analysis'),
      ).not.toBe(base);
      expect(buildRateLimitKey(ORG_ID, USER_ID, 'other-analysis')).not.toBe(base);
    });

    it('cannot be forged with key separators from a dynamic segment', () => {
      expect(sanitizeKeySegment('a:b c')).toBe('a_b_c');
      expect(buildRateLimitKey(ORG_ID, USER_ID, 'retention-analysis:admin')).toBe(
        `ai:ratelimit:${ORG_ID}:${USER_ID}:retention-analysis_admin`,
      );
    });

    it('scopes budget keys to one organization and one UTC window', () => {
      expect(buildDailyTokenBudgetKey(ORG_ID, '2026-09-13')).toBe(
        `ai:budget:${ORG_ID}:2026-09-13`,
      );
      expect(buildMonthlyCostBudgetKey(ORG_ID, '2026-09')).toBe(`ai:cost:${ORG_ID}:2026-09`);
      expect(buildDailyTokenBudgetKey(ORG_ID, '2026-09-13')).not.toBe(
        buildDailyTokenBudgetKey(OTHER_ORG_ID, '2026-09-13'),
      );
    });
  });

  describe('deterministic UTC windows', () => {
    it('labels days and months deterministically with zero padding', () => {
      expect(utcDayKey(new Date('2026-01-05T23:59:59.000Z'))).toBe('2026-01-05');
      expect(utcMonthKey(new Date('2026-01-05T23:59:59.000Z'))).toBe('2026-01');
    });

    it('computes [start, end) day bounds in UTC', () => {
      const { start, end } = utcDayBounds(new Date('2026-09-13T23:59:59.000Z'));
      expect(start.toISOString()).toBe('2026-09-13T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    });

    it('computes [start, end) month bounds in UTC', () => {
      const { start, end } = utcMonthBounds(new Date('2026-09-30T12:00:00.000Z'));
      expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });

    it('never returns a non-positive TTL, and aligns the TTL with the window end', () => {
      expect(secondsUntil(new Date('2026-09-14T00:00:00.000Z'), new Date('2026-09-13T12:00:00.000Z'))).toBe(
        43_200,
      );
      expect(secondsUntil(new Date('2026-09-14T00:00:00.000Z'), new Date('2026-09-14T00:00:00.000Z'))).toBe(1);
      expect(AI_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    });
  });

  describe('toCounterNumber', () => {
    it('normalizes Redis/SQL counter values without inventing usage', () => {
      expect(toCounterNumber(null)).toBe(0);
      expect(toCounterNumber(undefined)).toBe(0);
      expect(toCounterNumber('not-a-number')).toBe(0);
      expect(toCounterNumber('-3')).toBe(0);
      expect(toCounterNumber('0')).toBe(0);
      expect(toCounterNumber('12.5')).toBe(12.5);
      expect(toCounterNumber(7)).toBe(7);
    });
  });

  describe('server-owned pricing', () => {
    it('computes cost deterministically from server-side prices only', () => {
      expect(estimateCostUsd('gpt-4o', 1_000_000, 0)).toBe('2.500000');
      expect(estimateCostUsd('gpt-4o', 0, 1_000_000)).toBe('10.000000');
      expect(estimateCostUsd('gpt-4o', 0, 0)).toBe('0.000000');
      expect(estimateCostUsd('gpt-4o', -10, -10)).toBe('0.000000');
    });

    it('reports unknown pricing as unknown instead of fabricating a cost', () => {
      expect(estimateCostUsd('mock-deterministic-v1', 1000, 1000)).toBeNull();
      expect(isModelPriced('mock-deterministic-v1')).toBe(false);
      expect(isModelPriced('gpt-4o')).toBe(true);
    });
  });
});
