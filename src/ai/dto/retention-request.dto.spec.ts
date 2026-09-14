import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RetentionAnalysisRequestDto } from './retention-request.dto';

/**
 * Tenancy/injection guard for the retention-analysis request contract.
 *
 * The tenant is derived from the route + verified JWT and then re-authorized by
 * `TenantContextService`; it must never be possible to influence it through the
 * request body, and the analysis window stays inside the supported bounds.
 *
 * The validation options mirror `main.ts` (`whitelist: true, transform: true`).
 */
const BRANCH_ID = '11111111-1111-4111-8111-111111111111';

const validatePayload = async (payload: Record<string, unknown>) => {
  const instance = plainToInstance(RetentionAnalysisRequestDto, payload);
  return { instance, errors: await validate(instance, { whitelist: true }) };
};

describe('RetentionAnalysisRequestDto', () => {
  it('accepts an empty body (whole organization, default period)', async () => {
    const { errors } = await validatePayload({});
    expect(errors).toHaveLength(0);
  });

  it.each(['30d', '90d', '1y'])('accepts period %s', async (period) => {
    const { errors } = await validatePayload({ period });
    expect(errors).toHaveLength(0);
  });

  it.each(['1d', '7d', '2y', 'all', ''])('rejects unsupported period %p', async (period) => {
    const { errors } = await validatePayload({ period });
    expect(errors.map((error) => error.property)).toContain('period');
  });

  it('accepts a v4 branch uuid', async () => {
    const { errors } = await validatePayload({ branch_id: BRANCH_ID });
    expect(errors).toHaveLength(0);
  });

  it.each(['branch-1', 'not-a-uuid', ''])(
    'rejects malformed branch_id %p',
    async (branchId) => {
      const { errors } = await validatePayload({ branch_id: branchId });
      expect(errors.map((error) => error.property)).toContain('branch_id');
    },
  );

  it('strips a client-supplied organization_id (no tenant spoofing)', async () => {
    const { instance, errors } = await validatePayload({
      period: '30d',
      organization_id: 'attacker-org',
    });

    expect(errors).toHaveLength(0);
    expect(instance).not.toHaveProperty('organization_id');
    expect(Object.keys(instance)).toEqual(['period']);
  });

  it('does not declare a tenant field on the DTO at all', () => {
    expect(new RetentionAnalysisRequestDto()).not.toHaveProperty('organization_id');
  });
});
