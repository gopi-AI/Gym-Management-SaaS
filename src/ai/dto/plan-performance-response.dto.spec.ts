import {
  AiOutputValidationError,
  PLAN_PERFORMANCE_PRIORITIES,
  validatePlanPerformanceModelOutput,
} from './plan-performance-response.dto';
import { PLAN_PERFORMANCE_MAX_RECOMMENDATIONS } from '../prompts/plan-performance.prompt';

/**
 * The model output is UNTRUSTED. These tests pin the tenant-containment and
 * schema guarantees of the validator that every provider response passes
 * through before it can reach a caller.
 */
const authorized = new Map<string, string>([
  ['plan-1', 'Gold'],
  ['plan-2', 'Silver'],
]);

const validRecommendation = (planId: string, priority = 'high') => ({
  plan_id: planId,
  priority,
  issue: 'High churn rate (75%) across 4 membership(s)',
  recommended_action: 'Review price and benefits with the members who cancelled.',
});

const validOutput = (overrides: Record<string, unknown> = {}) => ({
  portfolio_health: 0.4,
  recommendations: [validRecommendation('plan-1')],
  summary: 'Two plans reviewed; one needs attention.',
  ...overrides,
});

describe('validatePlanPerformanceModelOutput', () => {
  it('accepts a well-formed response', () => {
    const result = validatePlanPerformanceModelOutput(validOutput(), authorized);

    expect(result.portfolio_health).toBe(0.4);
    expect(result.summary).toBe('Two plans reviewed; one needs attention.');
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].plan_id).toBe('plan-1');
  });

  it('takes the plan name from the authorized dataset, not from the model', () => {
    const result = validatePlanPerformanceModelOutput(
      validOutput({
        recommendations: [{ ...validRecommendation('plan-1'), name: 'Injected name' }],
      }),
      authorized,
    );

    expect(result.recommendations[0].name).toBe('Gold');
    expect(JSON.stringify(result)).not.toContain('Injected name');
  });

  it('drops recommendations whose plan_id is outside the authorized tenant', () => {
    const result = validatePlanPerformanceModelOutput(
      validOutput({
        recommendations: [validRecommendation('plan-1'), validRecommendation('other-tenant-plan')],
      }),
      authorized,
    );

    expect(result.recommendations.map((entry) => entry.plan_id)).toEqual(['plan-1']);
  });

  it('de-duplicates repeated plan ids', () => {
    const result = validatePlanPerformanceModelOutput(
      validOutput({
        recommendations: [
          validRecommendation('plan-1', 'medium'),
          validRecommendation('plan-1', 'low'),
        ],
      }),
      authorized,
    );

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].priority).toBe('medium');
  });

  it('sorts recommendations by priority (high, medium, low)', () => {
    const plans = new Map<string, string>([
      ['plan-1', 'Gold'],
      ['plan-2', 'Silver'],
      ['plan-3', 'Bronze'],
    ]);

    const result = validatePlanPerformanceModelOutput(
      validOutput({
        recommendations: [
          validRecommendation('plan-3', 'low'),
          validRecommendation('plan-1', 'high'),
          validRecommendation('plan-2', 'medium'),
        ],
      }),
      plans,
    );

    expect(result.recommendations.map((entry) => entry.priority)).toEqual([
      'high',
      'medium',
      'low',
    ]);
    expect(result.recommendations.map((entry) => entry.plan_id)).toEqual([
      'plan-1',
      'plan-2',
      'plan-3',
    ]);
  });

  it('caps the number of returned recommendations', () => {
    const plans = new Map<string, string>();
    const recommendations: Array<ReturnType<typeof validRecommendation>> = [];
    for (let index = 0; index < PLAN_PERFORMANCE_MAX_RECOMMENDATIONS + 5; index += 1) {
      const id = `plan-${index}`;
      plans.set(id, `Plan ${index}`);
      recommendations.push(validRecommendation(id));
    }

    const result = validatePlanPerformanceModelOutput(validOutput({ recommendations }), plans);

    expect(result.recommendations).toHaveLength(PLAN_PERFORMANCE_MAX_RECOMMENDATIONS);
  });

  it('accepts an absent recommendations array', () => {
    const result = validatePlanPerformanceModelOutput(
      validOutput({ recommendations: undefined }),
      authorized,
    );

    expect(result.recommendations).toEqual([]);
  });

  it('ignores server-owned fields supplied by the model', () => {
    const result = validatePlanPerformanceModelOutput(
      validOutput({ organization_id: 'attacker-org', generated_at: '2000-01-01T00:00:00.000Z' }),
      authorized,
    );

    expect(result).not.toHaveProperty('organization_id');
    expect(result).not.toHaveProperty('generated_at');
  });

  it('declares the full priority vocabulary used by the validator', () => {
    expect(PLAN_PERFORMANCE_PRIORITIES).toEqual(['high', 'medium', 'low']);
  });

  const malformedCases: Array<[string, unknown]> = [
    ['a non-object payload', 'nope'],
    ['a null payload', null],
    ['a missing portfolio_health', validOutput({ portfolio_health: undefined })],
    ['an out-of-range portfolio_health', validOutput({ portfolio_health: 1.2 })],
    ['a negative portfolio_health', validOutput({ portfolio_health: -0.1 })],
    ['a string portfolio_health', validOutput({ portfolio_health: '0.5' })],
    ['an empty summary', validOutput({ summary: '   ' })],
    ['a non-string summary', validOutput({ summary: 42 })],
    ['a non-array recommendations', validOutput({ recommendations: 'nope' })],
    ['a non-object recommendation entry', validOutput({ recommendations: ['nope'] })],
    ['a recommendation without plan_id', validOutput({ recommendations: [{}] })],
    ['an unknown priority', validOutput({ recommendations: [validRecommendation('plan-1', 'urgent')] })],
    [
      'a missing priority',
      validOutput({ recommendations: [{ ...validRecommendation('plan-1'), priority: undefined }] }),
    ],
    ['an empty issue', validOutput({ recommendations: [{ ...validRecommendation('plan-1'), issue: '  ' }] })],
    [
      'an empty recommended_action',
      validOutput({
        recommendations: [{ ...validRecommendation('plan-1'), recommended_action: '' }],
      }),
    ],
  ];

  it.each(malformedCases)('fails closed on %s', (_label, payload) => {
    expect(() => validatePlanPerformanceModelOutput(payload, authorized)).toThrow(
      AiOutputValidationError,
    );
  });

  it('exposes the shared, audited error code for the audit trail', () => {
    expect.assertions(2);
    try {
      validatePlanPerformanceModelOutput(null, authorized);
    } catch (error) {
      expect(error).toBeInstanceOf(AiOutputValidationError);
      expect((error as AiOutputValidationError).code).toBe('AI_MALFORMED_RESPONSE');
    }
  });

  it('truncates over-long free text instead of failing the request', () => {
    const result = validatePlanPerformanceModelOutput(
      validOutput({
        recommendations: [
          {
            ...validRecommendation('plan-1'),
            issue: 'i'.repeat(500),
            recommended_action: 'a'.repeat(900),
          },
        ],
      }),
      authorized,
    );

    expect(result.recommendations[0].issue).toHaveLength(200);
    expect(result.recommendations[0].recommended_action).toHaveLength(500);
  });
});
