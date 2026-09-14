import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { Member } from '../../members/entities/member.entity';
import { Membership } from '../../memberships/entities/membership.entity';
import { MembershipPlan } from '../../memberships/entities/membership-plan.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { TenantSettings } from '../../tenancy/entities/tenant-settings.entity';
import { RetentionService } from './retention.service';
import { AiExecutionRequest, AiService } from './ai.service';
import { RetentionAnalysisRequestDto } from '../dto/retention-request.dto';
import { ValidatedRetentionModelOutput } from '../dto/retention-response.dto';
import { RETENTION_MAX_RECORDS, RETENTION_SYSTEM_PROMPT } from '../prompts/retention.prompt';

/**
 * Tenancy, dataset-minimisation and no-spend-on-empty-data tests for the
 * retention analysis workflow. All repositories and the AI gateway are mocked:
 * no database and no provider call.
 */
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '44444444-4444-4444-8444-444444444444';
const MEMBER_ID = '55555555-5555-4555-8555-555555555555';
const INACTIVE_MEMBER_ID = '66666666-6666-4666-8666-666666666666';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

const buildMembership = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'membership-1',
    organization_id: ORG_ID,
    branch_id: BRANCH_ID,
    member_id: MEMBER_ID,
    plan_id: 'plan-1',
    status: 'active',
    start_date: daysAgo(200).toISOString(),
    end_date: null,
    cancelled_at: null,
    renewal_date: daysAgo(-10).toISOString(),
    created_at: daysAgo(200),
    ...overrides,
  }) as unknown as Membership;

const buildMember = (overrides: Record<string, unknown> = {}) =>
  ({
    id: MEMBER_ID,
    organization_id: ORG_ID,
    first_name: 'Ada',
    last_name: 'Lovelace',
    preferred_name: null,
    is_active: true,
    ...overrides,
  }) as unknown as Member;

const modelOutput = (overrides: Record<string, unknown> = {}) => ({
  retention_rate: 0.5,
  total_members: 99,
  at_risk_count: 1,
  at_risk_members: [
    {
      member_id: MEMBER_ID,
      name: 'Model Provided Name',
      risk_score: 0.8,
      risk_factors: ['renewal overdue'],
      recommended_action: 'Call the member',
    },
  ],
  summary: 'One of two members is at risk.',
  ...overrides,
});

describe('RetentionService', () => {
  let service: RetentionService;
  let tenantContext: Record<string, jest.Mock>;
  let aiService: Record<string, jest.Mock>;
  let membershipRepository: Record<string, jest.Mock>;
  let memberRepository: Record<string, jest.Mock>;
  let planRepository: Record<string, jest.Mock>;
  let branchRepository: Record<string, jest.Mock>;
  let tenantSettingsRepository: Record<string, jest.Mock>;

  const executeArgs = () =>
    aiService.execute.mock.calls[0][0] as AiExecutionRequest<ValidatedRetentionModelOutput>;

  beforeEach(async () => {
    tenantContext = {
      requireBranchAccess: jest
        .fn()
        .mockResolvedValue({ id: BRANCH_ID, name: 'Downtown' } as unknown as Branch),
    };
    aiService = { execute: jest.fn().mockResolvedValue(modelOutput()) };
    membershipRepository = { find: jest.fn().mockResolvedValue([buildMembership()]) };
    memberRepository = { find: jest.fn().mockResolvedValue([buildMember()]) };
    planRepository = { find: jest.fn().mockResolvedValue([{ id: 'plan-1', name: 'Gold' }]) };
    branchRepository = {
      find: jest.fn().mockResolvedValue([{ id: BRANCH_ID, name: 'Downtown' }]),
    };
    tenantSettingsRepository = {
      findOne: jest.fn().mockResolvedValue({
        organization_id: ORG_ID,
        time_zone: 'UTC',
        locale: 'en-US',
        currency: 'USD',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: TenantContextService, useValue: tenantContext },
        { provide: AiService, useValue: aiService },
        { provide: getRepositoryToken(Membership), useValue: membershipRepository },
        { provide: getRepositoryToken(Member), useValue: memberRepository },
        { provide: getRepositoryToken(MembershipPlan), useValue: planRepository },
        { provide: getRepositoryToken(Branch), useValue: branchRepository },
        { provide: getRepositoryToken(TenantSettings), useValue: tenantSettingsRepository },
      ],
    }).compile();

    service = module.get<RetentionService>(RetentionService);
  });

  const analyze = (dto: Partial<RetentionAnalysisRequestDto> = {}) =>
    service.analyze(ORG_ID, USER_ID, dto as RetentionAnalysisRequestDto);

  describe('tenant-scoped data loading', () => {
    it('reads only the authorized organization and bounds the dataset', async () => {
      await analyze();

      expect(membershipRepository.find).toHaveBeenCalledTimes(1);
      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: { organization_id: ORG_ID },
        order: { created_at: 'DESC' },
        take: RETENTION_MAX_RECORDS,
      });
      expect(JSON.stringify(membershipRepository.find.mock.calls)).not.toContain(OTHER_ORG_ID);
    });

    it('resolves members with explicit organization and active predicates', async () => {
      await analyze();

      const [memberQuery] = memberRepository.find.mock.calls[0];
      expect(memberQuery.where.organization_id).toBe(ORG_ID);
      expect(memberQuery.where.is_active).toBe(true);
      expect(memberQuery.where.id.value).toEqual([MEMBER_ID]);
    });

    it('scopes the plan and branch lookups to the authorized organization', async () => {
      await analyze();

      expect(planRepository.find.mock.calls[0][0].where.organization_id).toBe(ORG_ID);
      expect(branchRepository.find.mock.calls[0][0].where.organization_id).toBe(ORG_ID);
    });

    it('re-authorizes the branch and filters by it when requested', async () => {
      await analyze({ branch_id: BRANCH_ID });

      expect(tenantContext.requireBranchAccess).toHaveBeenCalledWith(ORG_ID, BRANCH_ID);
      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: { organization_id: ORG_ID, branch_id: BRANCH_ID },
        order: { created_at: 'DESC' },
        take: RETENTION_MAX_RECORDS,
      });
    });

    it('refuses a branch outside the authorized organization before reading any data', async () => {
      tenantContext.requireBranchAccess.mockRejectedValue(new ForbiddenException('denied'));

      await expect(analyze({ branch_id: BRANCH_ID })).rejects.toBeInstanceOf(ForbiddenException);
      expect(membershipRepository.find).not.toHaveBeenCalled();
      expect(aiService.execute).not.toHaveBeenCalled();
    });

    it('does not consult the branch authorizer when no branch filter is requested', async () => {
      await analyze();

      expect(tenantContext.requireBranchAccess).not.toHaveBeenCalled();
    });

    it('ignores the organization passed in the client body', async () => {
      await analyze({ organization_id: OTHER_ORG_ID } as Partial<RetentionAnalysisRequestDto>);

      const where = membershipRepository.find.mock.calls[0][0].where;
      expect(where).toEqual({ organization_id: ORG_ID });
      expect(executeArgs().organizationId).toBe(ORG_ID);
    });
  });

  describe('prompt construction and data minimisation', () => {
    it('sends the server-owned system prompt without tenant or member data', async () => {
      await analyze();

      const { systemPrompt } = executeArgs();
      expect(systemPrompt).toBe(RETENTION_SYSTEM_PROMPT);
      expect(systemPrompt).not.toContain('Ada');
      expect(systemPrompt).not.toContain(ORG_ID);
    });

    it('sends tenant identity, the resolved period and bounded membership facts only', async () => {
      await analyze();

      const request = executeArgs();
      expect(request.organizationId).toBe(ORG_ID);
      expect(request.userId).toBe(USER_ID);
      expect(request.requestType).toBe('retention-analysis');
      expect(request.promptSummary).toContain('period=90d; branch=all; memberships=1; members=1');

      const content = JSON.parse(request.userContent);
      expect(content.period).toMatchObject({ label: '90d', days: 90 });
      expect(content.max_at_risk_members).toBe(50);
      expect(content.tenant).toEqual({
        organization_id: ORG_ID,
        time_zone: 'UTC',
        locale: 'en-US',
        currency: 'USD',
        branch_id: null,
        branch_name: null,
      });
      expect(content.data.memberships).toEqual([
        {
          member_id: MEMBER_ID,
          name: 'Ada Lovelace',
          status: 'active',
          start_date: expect.any(String),
          end_date: null,
          renewal_date: expect.any(String),
          plan_name: 'Gold',
          branch_name: 'Downtown',
        },
      ]);
    });

    it('uses the preferred name for display when one is set', async () => {
      memberRepository.find.mockResolvedValue([buildMember({ preferred_name: '  Ada L  ' })]);

      await analyze();

      const content = JSON.parse(executeArgs().userContent);
      expect(content.data.memberships[0].name).toBe('Ada L');
    });

    it('drops members this organization cannot see and never invents identities', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership(),
        buildMembership({ id: 'membership-2', member_id: INACTIVE_MEMBER_ID }),
      ]);

      await analyze();

      const content = JSON.parse(executeArgs().userContent);
      expect(content.data.memberships.map((entry: { member_id: string }) => entry.member_id)).toEqual(
        [MEMBER_ID],
      );
      expect(memberRepository.find.mock.calls[0][0].where.is_active).toBe(true);
    });

    it('falls back to null for a missing plan or branch name', async () => {
      planRepository.find.mockResolvedValue([]);
      branchRepository.find.mockResolvedValue([]);

      await analyze();

      const content = JSON.parse(executeArgs().userContent);
      expect(content.data.memberships[0].plan_name).toBeNull();
      expect(content.data.memberships[0].branch_name).toBeNull();
    });
  });

  describe('no spend on empty or out-of-window data', () => {
    it('returns a clearly-worded empty result without calling the provider', async () => {
      membershipRepository.find.mockResolvedValue([]);

      const result = await analyze();

      expect(aiService.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        organization_id: ORG_ID,
        retention_rate: 0,
        total_members: 0,
        at_risk_count: 0,
        at_risk_members: [],
      });
      expect(result.summary).toMatch(/no memberships/i);
      expect(new Date(result.generated_at).toISOString()).toBe(result.generated_at);
    });

    it('ignores cancellations that terminated before the analysis window', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership({
          status: 'cancelled',
          end_date: daysAgo(400).toISOString(),
          cancelled_at: daysAgo(400).toISOString(),
        }),
      ]);

      const result = await analyze({ period: '30d' });

      expect(aiService.execute).not.toHaveBeenCalled();
      expect(result.total_members).toBe(0);
    });

    it('keeps cancellations that terminated inside the analysis window', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership({
          status: 'cancelled',
          end_date: daysAgo(5).toISOString(),
          cancelled_at: daysAgo(5).toISOString(),
        }),
      ]);

      await analyze({ period: '30d' });

      const content = JSON.parse(executeArgs().userContent);
      expect(content.data.memberships[0].status).toBe('cancelled');
    });

    it('treats a paused membership as relevant regardless of its end date', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership({ status: 'paused', end_date: daysAgo(900).toISOString() }),
      ]);

      await analyze({ period: '30d' });

      const content = JSON.parse(executeArgs().userContent);
      expect(content.data.memberships[0].status).toBe('paused');
    });
  });

  describe('output containment and response assembly', () => {
    it('filters model-flagged members outside the authorized dataset', async () => {
      await analyze();

      const parsed = executeArgs().parseModelOutput({
        retention_rate: 0.5,
        total_members: 99,
        at_risk_count: 2,
        at_risk_members: [
          {
            member_id: MEMBER_ID,
            name: 'Model Supplied Name',
            risk_score: 0.9,
            risk_factors: [],
            recommended_action: 'call',
          },
          {
            member_id: 'other-tenant-member',
            name: 'Ghost Member',
            risk_score: 0.9,
            risk_factors: [],
            recommended_action: 'call',
          },
        ],
        summary: 'two at risk',
      });

      expect(parsed.at_risk_members.map((entry) => entry.member_id)).toEqual([MEMBER_ID]);
      expect(parsed.at_risk_members[0].name).toBe('Ada Lovelace');
      expect(JSON.stringify(parsed)).not.toContain('Ghost Member');
    });

    it('reports the authorized organization, member count and a fresh ISO timestamp', async () => {
      const result = await analyze();

      expect(result.organization_id).toBe(ORG_ID);
      expect(result.total_members).toBe(1);
      expect(result.at_risk_count).toBe(1);
      expect(new Date(result.generated_at).toISOString()).toBe(result.generated_at);
      expect(result.summary).toBe('One of two members is at risk.');
    });

    it('hands the gateway a compact, non-sensitive audit summary', async () => {
      await analyze();

      expect(executeArgs().summarizeResult(modelOutput())).toBe('retention_rate=0.5; at_risk=1');
    });

    it('propagates a provider failure to the caller', async () => {
      aiService.execute.mockRejectedValue(new Error('AI provider returned an unusable response'));

      await expect(analyze()).rejects.toThrow('AI provider returned an unusable response');
    });
  });
});
