import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { Membership } from '../../memberships/entities/membership.entity';
import { MembershipPlan } from '../../memberships/entities/membership-plan.entity';
import { MembershipHistory } from '../../memberships/entities/membership-history.entity';
import { TenantSettings } from '../../tenancy/entities/tenant-settings.entity';
import {
  PLAN_PERFORMANCE_MAX_HISTORY_ROWS,
  PLAN_PERFORMANCE_MAX_MEMBERSHIPS,
  PlanPerformanceService,
} from './plan-performance.service';
import { AiExecutionRequest, AiService } from './ai.service';
import { PlanPerformanceRequestDto } from '../dto/plan-performance-request.dto';
import { ValidatedPlanPerformanceModelOutput } from '../dto/plan-performance-response.dto';
import {
  PLAN_PERFORMANCE_MAX_PLANS,
  PLAN_PERFORMANCE_SYSTEM_PROMPT,
} from '../prompts/plan-performance.prompt';

/**
 * Tenancy, dataset-minimisation and business-calculation tests for the
 * plan-performance workflow. All repositories and the AI gateway are mocked:
 * no database and no provider call.
 */
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '44444444-4444-4444-8444-444444444444';

const buildPlan = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'plan-1',
    organization_id: ORG_ID,
    name: 'Gold',
    price: '49.99',
    currency: 'USD',
    billing_period: 'monthly',
    duration_days: 30,
    trial_days: 0,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as unknown as MembershipPlan;

const buildMembership = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'membership-1',
    organization_id: ORG_ID,
    member_id: 'member-1',
    plan_id: 'plan-1',
    branch_id: BRANCH_ID,
    status: 'active',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
    renewal_date: '2026-01-31',
    price_at_signup: '49.99',
    currency_at_signup: 'USD',
    cancellation_reason: 'Moved city',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as unknown as Membership;

const buildHistory = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'history-1',
    membership_id: 'membership-1',
    organization_id: ORG_ID,
    member_id: 'member-1',
    from_status: 'active',
    to_status: 'cancelled',
    transition: 'cancel',
    reason: 'Moved city',
    occurred_at: new Date(),
    ...overrides,
  }) as unknown as MembershipHistory;

const baseModelOutput = (): ValidatedPlanPerformanceModelOutput => ({
  portfolio_health: 0.5,
  recommendations: [
    {
      plan_id: 'plan-1',
      name: 'Model Supplied Name',
      priority: 'high',
      issue: 'One of four memberships was cancelled',
      recommended_action: 'Review the cancellation reasons for this plan.',
    },
  ],
  summary: 'One plan needs attention.',
});

const modelOutput = (overrides: Record<string, unknown> = {}) =>
  ({ ...baseModelOutput(), ...overrides }) as ValidatedPlanPerformanceModelOutput;

describe('PlanPerformanceService', () => {
  let service: PlanPerformanceService;
  let tenantContext: Record<string, jest.Mock>;
  let aiService: Record<string, jest.Mock>;
  let planRepository: Record<string, jest.Mock>;
  let membershipRepository: Record<string, jest.Mock>;
  let historyRepository: Record<string, jest.Mock>;
  let tenantSettingsRepository: Record<string, jest.Mock>;

  const executeArgs = () =>
    aiService.execute.mock.calls[0][0] as AiExecutionRequest<ValidatedPlanPerformanceModelOutput>;

  beforeEach(async () => {
    tenantContext = {
      requireBranchAccess: jest
        .fn()
        .mockResolvedValue({ id: BRANCH_ID, name: 'Downtown' } as unknown),
    };
    aiService = { execute: jest.fn().mockResolvedValue(modelOutput()) };
    planRepository = { find: jest.fn().mockResolvedValue([buildPlan()]) };
    membershipRepository = { find: jest.fn().mockResolvedValue([buildMembership()]) };
    historyRepository = { find: jest.fn().mockResolvedValue([]) };
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
        PlanPerformanceService,
        { provide: TenantContextService, useValue: tenantContext },
        { provide: AiService, useValue: aiService },
        { provide: getRepositoryToken(Membership), useValue: membershipRepository },
        { provide: getRepositoryToken(MembershipPlan), useValue: planRepository },
        { provide: getRepositoryToken(MembershipHistory), useValue: historyRepository },
        { provide: getRepositoryToken(TenantSettings), useValue: tenantSettingsRepository },
      ],
    }).compile();

    service = module.get<PlanPerformanceService>(PlanPerformanceService);
  });

  const analyze = (dto: Partial<PlanPerformanceRequestDto> = {}) =>
    service.analyze(ORG_ID, USER_ID, dto as PlanPerformanceRequestDto);

  describe('tenant-scoped data loading', () => {
    it('reads only the authorized organization and bounds both datasets', async () => {
      await analyze();

      expect(planRepository.find).toHaveBeenCalledWith({
        where: { organization_id: ORG_ID },
        order: { created_at: 'DESC' },
        take: PLAN_PERFORMANCE_MAX_PLANS,
      });
      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: { organization_id: ORG_ID },
        order: { created_at: 'DESC' },
        take: PLAN_PERFORMANCE_MAX_MEMBERSHIPS,
      });
      expect(JSON.stringify(planRepository.find.mock.calls)).not.toContain(OTHER_ORG_ID);
      expect(JSON.stringify(membershipRepository.find.mock.calls)).not.toContain(OTHER_ORG_ID);
    });

    it('scopes the lifecycle read to the organization and the authorized memberships', async () => {
      await analyze();

      const [historyQuery] = historyRepository.find.mock.calls[0];
      expect(historyQuery.where.organization_id).toBe(ORG_ID);
      expect(historyQuery.where.membership_id.value).toEqual(['membership-1']);
      expect(historyQuery.where.occurred_at.type).toBe('moreThanOrEqual');
      expect(historyQuery.take).toBe(PLAN_PERFORMANCE_MAX_HISTORY_ROWS);
      expect(JSON.stringify(historyRepository.find.mock.calls)).not.toContain(OTHER_ORG_ID);
    });

    it('skips the lifecycle read when no membership is attributable to a plan', async () => {
      membershipRepository.find.mockResolvedValue([buildMembership({ plan_id: null })]);

      await analyze();

      expect(historyRepository.find).not.toHaveBeenCalled();
    });

    it('re-authorizes the branch and filters by it when requested', async () => {
      await analyze({ branch_id: BRANCH_ID });

      expect(tenantContext.requireBranchAccess).toHaveBeenCalledWith(ORG_ID, BRANCH_ID);
      expect(membershipRepository.find).toHaveBeenCalledWith({
        where: { organization_id: ORG_ID, branch_id: BRANCH_ID },
        order: { created_at: 'DESC' },
        take: PLAN_PERFORMANCE_MAX_MEMBERSHIPS,
      });
    });

    it('refuses a branch outside the authorized organization before reading any data', async () => {
      tenantContext.requireBranchAccess.mockRejectedValue(new ForbiddenException('denied'));

      await expect(analyze({ branch_id: BRANCH_ID })).rejects.toBeInstanceOf(ForbiddenException);
      expect(planRepository.find).not.toHaveBeenCalled();
      expect(membershipRepository.find).not.toHaveBeenCalled();
      expect(aiService.execute).not.toHaveBeenCalled();
    });

    it('does not consult the branch authorizer when no branch is requested', async () => {
      await analyze();

      expect(tenantContext.requireBranchAccess).not.toHaveBeenCalled();
    });
  });

  describe('business calculations', () => {
    beforeEach(() => {
      planRepository.find.mockResolvedValue([
        buildPlan(),
        buildPlan({ id: 'plan-2', name: 'Silver', price: '99.99' }),
      ]);
      membershipRepository.find.mockResolvedValue([
        // Gold: 2 active (30 realized days each), 1 cancelled (60), 1 paused (no end date).
        buildMembership({ id: 'm1', status: 'active', start_date: '2026-01-01', end_date: '2026-01-31' }),
        buildMembership({ id: 'm2', status: 'active', start_date: '2026-02-01', end_date: '2026-03-03' }),
        buildMembership({ id: 'm3', status: 'cancelled', start_date: '2026-01-01', end_date: '2026-03-02' }),
        buildMembership({ id: 'm4', status: 'paused', end_date: null }),
        // Silver: 1 cancelled, discounted signup.
        buildMembership({
          id: 'm5',
          plan_id: 'plan-2',
          status: 'cancelled',
          start_date: '2026-01-01',
          end_date: '2026-03-31',
          price_at_signup: '79.99',
        }),
      ]);
    });

    it('computes per-plan membership counts, churn and realized duration', async () => {
      const result = await analyze();

      const gold = result.plans.find((plan) => plan.plan_id === 'plan-1');
      const silver = result.plans.find((plan) => plan.plan_id === 'plan-2');

      expect(gold).toMatchObject({
        name: 'Gold',
        total_memberships: 4,
        active_memberships: 2,
        paused_or_frozen_memberships: 1,
        cancelled_memberships: 1,
        churn_rate: 0.25,
        average_realized_days: 40,
        discounted_signups: 0,
        price_change_percent: 0,
      });
      expect(silver).toMatchObject({
        name: 'Silver',
        total_memberships: 1,
        active_memberships: 0,
        cancelled_memberships: 1,
        churn_rate: 1,
        average_realized_days: 89,
        discounted_signups: 1,
        price_change_percent: 25,
      });
    });

    it('computes the portfolio totals across every in-scope membership', async () => {
      const result = await analyze();

      expect(result).toMatchObject({
        period: '90d',
        total_plans: 2,
        analyzed_plans: 2,
        total_memberships: 5,
        active_memberships: 2,
        overall_churn_rate: 0.4,
      });

      const content = JSON.parse(executeArgs().userContent);
      expect(content.data.portfolio).toEqual({
        total_plans: 2,
        analyzed_plans: 2,
        active_plans: 2,
        inactive_plans: 0,
        total_memberships: 5,
        active_memberships: 2,
        cancelled_memberships: 2,
        memberships_without_plan: 0,
        overall_churn_rate: 0.4,
      });
    });

    it('counts non-lifecycle statuses (e.g. expired) in totals only', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership({ id: 'm1', status: 'active' }),
        buildMembership({ id: 'm2', status: 'expired' }),
      ]);

      const result = await analyze();

      expect(result.total_memberships).toBe(2);
      expect(result.active_memberships).toBe(1);
      expect(result.plans[0]).toMatchObject({
        total_memberships: 2,
        active_memberships: 1,
        cancelled_memberships: 0,
        paused_or_frozen_memberships: 0,
        churn_rate: 0,
      });
    });

    it('aggregates lifecycle transitions per plan and drops unrelated history rows', async () => {
      historyRepository.find.mockResolvedValue([
        buildHistory({ id: 'h1', membership_id: 'm1', transition: 'pause' }),
        buildHistory({ id: 'h2', membership_id: 'm1', transition: 'pause' }),
        buildHistory({ id: 'h3', membership_id: 'm3', transition: 'cancel' }),
        // Defence in depth: a row for a membership this request never authorized.
        buildHistory({ id: 'h4', membership_id: 'foreign-membership', transition: 'cancel' }),
      ]);

      const result = await analyze();

      const gold = result.plans.find((plan) => plan.plan_id === 'plan-1');
      expect(gold?.lifecycle_transitions).toEqual([
        { transition: 'pause', count: 2 },
        { transition: 'cancel', count: 1 },
      ]);

      const silver = result.plans.find((plan) => plan.plan_id === 'plan-2');
      expect(silver?.lifecycle_transitions).toEqual([]);
    });

    it('never attributes a membership to a plan from another organization', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership({ id: 'm1' }),
        buildMembership({
          id: 'm2',
          organization_id: OTHER_ORG_ID,
          plan_id: 'plan-foreign',
          status: 'cancelled',
        }),
      ]);

      const result = await analyze();

      expect(result.plans.map((plan) => plan.plan_id)).not.toContain('plan-foreign');
      expect(result.plans.find((plan) => plan.plan_id === 'plan-1')?.total_memberships).toBe(1);
      expect(result.plans.find((plan) => plan.plan_id === 'plan-2')?.total_memberships).toBe(0);
      expect(JSON.stringify(result)).not.toContain('plan-foreign');

      const content = JSON.parse(executeArgs().userContent);
      expect(content.data.portfolio.memberships_without_plan).toBe(1);
    });

    it('reports a null average when no membership has usable dates', async () => {
      membershipRepository.find.mockResolvedValue([
        buildMembership({ id: 'm1', start_date: null, end_date: null }),
      ]);

      const result = await analyze();

      expect(result.plans[0].average_realized_days).toBeNull();
      expect(result.plans[0].price_change_percent).toBe(0);
    });
  });

  describe('prompt construction and data minimisation', () => {
    it('sends the server-owned system prompt without tenant or business data', async () => {
      await analyze();

      const { systemPrompt } = executeArgs();
      expect(systemPrompt).toBe(PLAN_PERFORMANCE_SYSTEM_PROMPT);
      expect(systemPrompt).not.toContain('Gold');
      expect(systemPrompt).not.toContain(ORG_ID);
    });

    it('sends tenant identity, the resolved period and plan aggregates only', async () => {
      await analyze();

      const request = executeArgs();
      expect(request.organizationId).toBe(ORG_ID);
      expect(request.userId).toBe(USER_ID);
      expect(request.requestType).toBe('plan-performance-analysis');
      expect(request.promptSummary).toContain('period=90d; branch=all; plans=1; memberships=1');

      const content = JSON.parse(request.userContent);
      expect(content.task).toBe('membership_plan_performance_analysis');
      expect(content.period).toMatchObject({ label: '90d', days: 90 });
      expect(content.max_recommendations).toBe(10);
      expect(content.tenant).toEqual({
        organization_id: ORG_ID,
        time_zone: 'UTC',
        locale: 'en-US',
        currency: 'USD',
        branch_id: null,
        branch_name: null,
      });
      expect(Object.keys(content.data.plans[0]).sort()).toEqual([
        'active_memberships',
        'average_realized_days',
        'billing_period',
        'cancelled_memberships',
        'churn_rate',
        'currency',
        'discounted_signups',
        'duration_days',
        'is_active',
        'lifecycle',
        'name',
        'paused_or_frozen_memberships',
        'plan_id',
        'price',
        'price_change_percent',
        'total_memberships',
        'trial_days',
      ]);
      expect(content.data.plans[0]).toMatchObject({
        plan_id: 'plan-1',
        name: 'Gold',
        price: 49.99,
        total_memberships: 1,
        active_memberships: 1,
        churn_rate: 0,
      });
    });

    it('never puts member identity or free-text notes into the provider payload', async () => {
      await analyze();

      const raw = executeArgs().userContent;
      expect(raw).not.toContain('member_id');
      expect(raw).not.toContain('member-1');
      expect(raw).not.toContain('Moved city');
      expect(raw).not.toContain('member_name');
      expect(raw).not.toContain('email');
      expect(raw).not.toContain('phone');
    });

    it('passes the re-authorized branch name into the tenant context', async () => {
      await analyze({ branch_id: BRANCH_ID });

      const content = JSON.parse(executeArgs().userContent);
      expect(content.tenant.branch_id).toBe(BRANCH_ID);
      expect(content.tenant.branch_name).toBe('Downtown');
      expect(executeArgs().promptSummary).toContain(`branch=${BRANCH_ID}`);
    });
  });

  describe('output containment and response assembly', () => {
    it('filters model recommendations outside the authorized dataset', async () => {
      await analyze();

      const parsed = executeArgs().parseModelOutput({
        portfolio_health: 0.5,
        recommendations: [
          {
            plan_id: 'plan-1',
            name: 'Model Supplied Name',
            priority: 'high',
            issue: 'churn',
            recommended_action: 'act',
          },
          {
            plan_id: 'other-tenant-plan',
            name: 'Ghost Plan',
            priority: 'high',
            issue: 'churn',
            recommended_action: 'act',
          },
        ],
        summary: 'two plans',
      });

      expect(parsed.recommendations.map((entry) => entry.plan_id)).toEqual(['plan-1']);
      expect(parsed.recommendations[0].name).toBe('Gold');
      expect(JSON.stringify(parsed)).not.toContain('Ghost Plan');
    });

    it('reports the authorized organization, plan metrics and a fresh ISO timestamp', async () => {
      const result = await analyze();

      expect(result.organization_id).toBe(ORG_ID);
      expect(result.total_plans).toBe(1);
      expect(result.plans[0].plan_id).toBe('plan-1');
      expect(result.recommendations).toHaveLength(1);
      expect(new Date(result.generated_at).toISOString()).toBe(result.generated_at);
      expect(result.summary).toBe('One plan needs attention.');
      expect(result.portfolio_health).toBe(0.5);
    });

    it('hands the gateway a compact, non-sensitive audit summary', async () => {
      await analyze();

      expect(executeArgs().summarizeResult(modelOutput({ portfolio_health: 0.25 }))).toBe(
        'portfolio_health=0.25; recommendations=1',
      );
    });

    it('propagates a provider failure to the caller', async () => {
      aiService.execute.mockRejectedValue(new Error('AI provider returned an unusable response'));

      await expect(analyze()).rejects.toThrow('AI provider returned an unusable response');
    });
  });

  describe('no spend on empty data', () => {
    it('returns a clearly-worded empty result without calling the provider when no plans exist', async () => {
      planRepository.find.mockResolvedValue([]);

      const result = await analyze();

      expect(aiService.execute).not.toHaveBeenCalled();
      expect(membershipRepository.find).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        organization_id: ORG_ID,
        total_plans: 0,
        total_memberships: 0,
        plans: [],
        recommendations: [],
        portfolio_health: 0,
      });
      expect(result.summary).toMatch(/no membership plans/i);
      expect(new Date(result.generated_at).toISOString()).toBe(result.generated_at);
    });

    it('returns a clearly-worded empty result without calling the provider when no memberships exist', async () => {
      membershipRepository.find.mockResolvedValue([]);

      const result = await analyze({ period: '30d' });

      expect(aiService.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        organization_id: ORG_ID,
        period: '30d',
        total_plans: 1,
        total_memberships: 0,
        plans: [],
      });
      expect(result.summary).toMatch(/no memberships/i);
    });
  });
});
