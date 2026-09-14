import { ConfigService } from '@nestjs/config';
import { MockAiProvider } from './mock.provider';
import { AiProviderError, AiRequest } from '../services/ai-provider.service';

/**
 * The mock provider is the offline/deterministic provider used by development
 * and by these tests, so its contract (valid JSON, deterministic scoring, hard
 * refusal in production) must stay stable.
 */
const buildConfig = (values: Record<string, string | undefined> = {}) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const buildRequest = (memberships: unknown[]): AiRequest => ({
  systemPrompt: 'system instructions',
  userContent: JSON.stringify({ data: { memberships } }),
  requestType: 'retention-analysis',
});

const FUTURE_RENEWAL = '2999-01-01';

const memberships = [
  { member_id: 'member-active', name: 'Active Member', status: 'active', renewal_date: FUTURE_RENEWAL },
  {
    member_id: 'member-cancelled',
    name: 'Cancelled Member',
    status: 'cancelled',
    renewal_date: FUTURE_RENEWAL,
  },
  { member_id: 'member-paused', name: 'Paused Member', status: 'paused', renewal_date: FUTURE_RENEWAL },
];

describe('MockAiProvider', () => {
  let provider: MockAiProvider;

  beforeEach(() => {
    provider = new MockAiProvider(buildConfig());
  });

  it('returns structured JSON with only the at-risk members flagged', async () => {
    const response = await provider.generate(buildRequest(memberships));
    const parsed = JSON.parse(response.content);

    expect(parsed.total_members).toBe(3);
    expect(parsed.retention_rate).toBeCloseTo(1 / 3, 2);
    expect(parsed.at_risk_count).toBe(2);
    expect(parsed.at_risk_members.map((entry: { member_id: string }) => entry.member_id)).toEqual([
      'member-cancelled',
      'member-paused',
    ]);
    expect(parsed.summary).toContain('3 membership record(s)');
    expect(parsed.summary).toContain('deterministic estimate');
  });

  it('is deterministic across invocations', async () => {
    const first = await provider.generate(buildRequest(memberships));
    const second = await provider.generate(buildRequest(memberships));

    expect(second.content).toBe(first.content);
  });

  it('reports provider/model/token telemetry', async () => {
    const response = await provider.generate(buildRequest(memberships));

    expect(response.provider).toBe('mock');
    expect(response.model).toBe('mock-deterministic-v1');
    expect(response.inputTokens).toBeGreaterThan(0);
    expect(response.outputTokens).toBeGreaterThan(0);
    expect(response.totalTokens).toBeGreaterThanOrEqual(response.inputTokens);
  });

  it('handles an empty dataset without inventing members', async () => {
    const response = await provider.generate(buildRequest([]));
    const parsed = JSON.parse(response.content);

    expect(parsed.total_members).toBe(0);
    expect(parsed.retention_rate).toBe(0);
    expect(parsed.at_risk_members).toEqual([]);
  });

  it('drops entries without a usable member_id', async () => {
    const response = await provider.generate(
      buildRequest([...memberships, { name: 'No id', status: 'cancelled' }]),
    );
    const parsed = JSON.parse(response.content);

    expect(parsed.total_members).toBe(3);
  });

  it('refuses to fabricate output in production', async () => {
    const productionProvider = new MockAiProvider(buildConfig({ NODE_ENV: 'production' }));

    await expect(productionProvider.generate(buildRequest(memberships))).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('reports AI_INVALID_REQUEST for a non-JSON payload', async () => {
    const request: AiRequest = {
      systemPrompt: 'system instructions',
      userContent: 'not json',
      requestType: 'retention-analysis',
    };

    await expect(provider.generate(request)).rejects.toBeInstanceOf(AiProviderError);
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: 'AI_INVALID_REQUEST',
      retryable: false,
    });
  });

  it('reports AI_INVALID_REQUEST when data.memberships is missing', async () => {
    const request: AiRequest = {
      systemPrompt: 'system instructions',
      userContent: JSON.stringify({ data: {} }),
      requestType: 'retention-analysis',
    };

    await expect(provider.generate(request)).rejects.toMatchObject({
      code: 'AI_INVALID_REQUEST',
      retryable: false,
    });
  });

  describe('plan-performance task', () => {
    const buildPlanRequest = (plans: unknown[], portfolio: Record<string, unknown> = {}) =>
      ({
        systemPrompt: 'system instructions',
        userContent: JSON.stringify({
          task: 'membership_plan_performance_analysis',
          data: {
            portfolio: { total_memberships: 2, active_memberships: 1, ...portfolio },
            plans,
          },
        }),
        requestType: 'plan-performance-analysis',
      }) as AiRequest;

    const plans = [
      {
        plan_id: 'plan-churn',
        name: 'Gold',
        is_active: true,
        total_memberships: 2,
        active_memberships: 0,
        cancelled_memberships: 2,
        churn_rate: 1,
        discounted_signups: 0,
      },
      {
        plan_id: 'plan-empty',
        name: 'Dormant',
        is_active: true,
        total_memberships: 0,
        active_memberships: 0,
        cancelled_memberships: 0,
        churn_rate: 0,
        discounted_signups: 0,
      },
    ];

    it('returns deterministic plan recommendations derived from the aggregates', async () => {
      const response = await provider.generate(buildPlanRequest(plans));
      const parsed = JSON.parse(response.content);

      expect(parsed.portfolio_health).toBe(0.5);
      expect(parsed.recommendations.map((entry: { plan_id: string }) => entry.plan_id)).toEqual([
        'plan-churn',
        'plan-empty',
      ]);
      expect(parsed.recommendations[0].priority).toBe('high');
      expect(parsed.recommendations[0].issue).toContain('100%');
      expect(parsed.recommendations[1].priority).toBe('low');
      expect(parsed.summary).toContain('2 plan(s)');
      expect(parsed.summary).toContain('deterministic estimate');
    });

    it('is deterministic across invocations', async () => {
      const first = await provider.generate(buildPlanRequest(plans));
      const second = await provider.generate(buildPlanRequest(plans));

      expect(second.content).toBe(first.content);
    });

    it('refuses to fabricate a plan-performance response in production', async () => {
      const productionProvider = new MockAiProvider(buildConfig({ NODE_ENV: 'production' }));

      await expect(productionProvider.generate(buildPlanRequest(plans))).rejects.toMatchObject({
        code: 'AI_NOT_CONFIGURED',
        retryable: false,
      });
    });

    it('reports AI_INVALID_REQUEST when data.plans is missing', async () => {
      const request: AiRequest = {
        systemPrompt: 'system instructions',
        userContent: JSON.stringify({
          task: 'membership_plan_performance_analysis',
          data: { portfolio: {} },
        }),
        requestType: 'plan-performance-analysis',
      };

      await expect(provider.generate(request)).rejects.toMatchObject({
        code: 'AI_INVALID_REQUEST',
        retryable: false,
      });
    });

    it('never echoes member-level data (it is not present in the payload)', async () => {
      const response = await provider.generate(
        buildPlanRequest([{ ...plans[0], member_id: 'member-1', name: 'Gold' }]),
      );

      expect(response.content).not.toContain('member-1');
    });
  });
});
