import {
  AiOutputValidationError,
  validateRetentionModelOutput,
} from './retention-response.dto';
import { RETENTION_MAX_AT_RISK } from '../prompts/retention.prompt';

/**
 * The model output is UNTRUSTED. These tests pin the tenant-containment and
 * schema guarantees of the validator that every provider response passes
 * through before it can reach a caller.
 */
const authorized = new Map<string, string>([
  ['member-1', 'Alice Anderson'],
  ['member-2', 'Bob Brown'],
]);

const validEntry = (memberId: string, riskScore = 0.8) => ({
  member_id: memberId,
  name: 'Injected Name',
  risk_score: riskScore,
  risk_factors: ['status is paused'],
  recommended_action: 'Call the member.',
});

const validOutput = (overrides: Record<string, unknown> = {}) => ({
  retention_rate: 0.72,
  total_members: 2,
  at_risk_count: 1,
  at_risk_members: [validEntry('member-1')],
  summary: 'Two members analysed; one is at risk.',
  ...overrides,
});

describe('validateRetentionModelOutput', () => {
  it('accepts a well-formed response', () => {
    const result = validateRetentionModelOutput(validOutput(), authorized);

    expect(result.retention_rate).toBe(0.72);
    expect(result.summary).toBe('Two members analysed; one is at risk.');
    expect(result.at_risk_members).toHaveLength(1);
    expect(result.at_risk_members[0].member_id).toBe('member-1');
  });

  it('takes the display name from the authorized dataset, not from the model', () => {
    const result = validateRetentionModelOutput(validOutput(), authorized);

    expect(result.at_risk_members[0].name).toBe('Alice Anderson');
  });

  it('drops at-risk entries whose member_id is outside the authorized tenant', () => {
    const result = validateRetentionModelOutput(
      validOutput({
        at_risk_members: [validEntry('member-1'), validEntry('other-tenant-member')],
      }),
      authorized,
    );

    expect(result.at_risk_members.map((entry) => entry.member_id)).toEqual(['member-1']);
  });

  it('de-duplicates repeated member ids', () => {
    const result = validateRetentionModelOutput(
      validOutput({
        at_risk_members: [validEntry('member-1', 0.6), validEntry('member-1', 0.9)],
      }),
      authorized,
    );

    expect(result.at_risk_members).toHaveLength(1);
    expect(result.at_risk_members[0].risk_score).toBe(0.6);
  });

  it('sorts members by descending risk score', () => {
    const result = validateRetentionModelOutput(
      validOutput({
        at_risk_members: [validEntry('member-1', 0.51), validEntry('member-2', 0.99)],
      }),
      authorized,
    );

    expect(result.at_risk_members.map((entry) => entry.member_id)).toEqual([
      'member-2',
      'member-1',
    ]);
  });

  it('caps the number of returned at-risk members', () => {
    const ids = new Map<string, string>();
    const entries: Array<ReturnType<typeof validEntry>> = [];
    for (let index = 0; index < RETENTION_MAX_AT_RISK + 10; index += 1) {
      const id = `member-${index}`;
      ids.set(id, `Member ${index}`);
      entries.push(validEntry(id, 0.5 + index / 1000));
    }

    const result = validateRetentionModelOutput(validOutput({ at_risk_members: entries }), ids);

    expect(result.at_risk_members).toHaveLength(RETENTION_MAX_AT_RISK);
  });

  it('sanitizes risk factors: trims, drops non-strings and caps at 10', () => {
    const result = validateRetentionModelOutput(
      validOutput({
        at_risk_members: [
          {
            ...validEntry('member-1'),
            risk_factors: [
              '  paused membership  ',
              42,
              '',
              ...Array.from({ length: 12 }, (_, index) => `factor-${index}`),
            ],
          },
        ],
      }),
      authorized,
    );

    expect(result.at_risk_members[0].risk_factors).toHaveLength(10);
    expect(result.at_risk_members[0].risk_factors[0]).toBe('paused membership');
    expect(result.at_risk_members[0].risk_factors).not.toContain(42);
  });

  it('ignores server-owned fields supplied by the model', () => {
    const result = validateRetentionModelOutput(
      validOutput({ organization_id: 'attacker-org', generated_at: '2000-01-01T00:00:00.000Z' }),
      authorized,
    );

    expect(result).not.toHaveProperty('organization_id');
    expect(result).not.toHaveProperty('generated_at');
  });

  it('accepts an absent at_risk_members array', () => {
    const result = validateRetentionModelOutput(
      validOutput({ at_risk_members: undefined }),
      authorized,
    );

    expect(result.at_risk_members).toEqual([]);
  });

  const malformedCases: Array<[string, unknown]> = [
    ['a non-object payload', 'nope'],
    ['a null payload', null],
    ['a missing retention_rate', validOutput({ retention_rate: undefined })],
    ['an out-of-range retention_rate', validOutput({ retention_rate: 1.5 })],
    ['a negative retention_rate', validOutput({ retention_rate: -0.1 })],
    ['a string retention_rate', validOutput({ retention_rate: '0.5' })],
    ['a non-integer total_members', validOutput({ total_members: 1.5 })],
    ['a negative total_members', validOutput({ total_members: -1 })],
    ['a missing at_risk_count', validOutput({ at_risk_count: undefined })],
    ['an empty summary', validOutput({ summary: '   ' })],
    ['a non-array at_risk_members', validOutput({ at_risk_members: 'nope' })],
    ['a non-object member entry', validOutput({ at_risk_members: ['nope'] })],
    ['a member entry without member_id', validOutput({ at_risk_members: [{}] })],
    [
      'an out-of-range risk_score',
      validOutput({ at_risk_members: [validEntry('member-1', 7)] }),
    ],
    [
      'a non-array risk_factors',
      validOutput({
        at_risk_members: [{ ...validEntry('member-1'), risk_factors: 'paused' }],
      }),
    ],
  ];

  it.each(malformedCases)('fails closed on %s', (_label, payload) => {
    expect(() => validateRetentionModelOutput(payload, authorized)).toThrow(
      AiOutputValidationError,
    );
  });

  it('exposes a stable error code for the audit trail', () => {
    expect.assertions(2);
    try {
      validateRetentionModelOutput(null, authorized);
    } catch (error) {
      expect(error).toBeInstanceOf(AiOutputValidationError);
      expect((error as AiOutputValidationError).code).toBe('AI_MALFORMED_RESPONSE');
    }
  });
});

