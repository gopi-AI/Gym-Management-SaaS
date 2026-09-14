import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { Membership } from '../../memberships/entities/membership.entity';
import { MembershipPlan } from '../../memberships/entities/membership-plan.entity';
import { MembershipHistory } from '../../memberships/entities/membership-history.entity';
import { TenantSettings } from '../../tenancy/entities/tenant-settings.entity';
import { AiService, AI_REQUEST_TYPE_PLAN_PERFORMANCE } from './ai.service';
import {
  PlanPerformancePeriodInfo,
  PlanPerformancePromptPlan,
  PlanPerformancePromptPortfolio,
  PlanPerformancePromptTransition,
  PlanPerformanceRequestDto,
  PlanPerformanceRequestPayload,
} from '../dto/plan-performance-request.dto';
import {
  PlanPerformancePlanDto,
  PlanPerformanceResponseDto,
  ValidatedPlanPerformanceModelOutput,
  validatePlanPerformanceModelOutput,
} from '../dto/plan-performance-response.dto';
import {
  PLAN_PERFORMANCE_MAX_PLANS,
  PLAN_PERFORMANCE_SYSTEM_PROMPT,
  buildPlanPerformanceUserContent,
} from '../prompts/plan-performance.prompt';
import {
  AI_ANALYSIS_DEFAULT_PERIOD,
  resolveAnalysisWindow,
} from '../config/ai-analysis-window';

const STATUS_ACTIVE = 'active';
const STATUS_CANCELLED = 'cancelled';
const STATUS_PAUSED = 'paused';
const STATUS_FROZEN = 'frozen';

/** Used by the realized-length arithmetic below (not window resolution). */
const MS_PER_DAY = 86_400_000;

/** Hard cap on the memberships aggregated per request (bounds the read cost). */
export const PLAN_PERFORMANCE_MAX_MEMBERSHIPS = 1_000;
/** Hard cap on the history rows aggregated per request. */
export const PLAN_PERFORMANCE_MAX_HISTORY_ROWS = 2_000;

/**
 * Read-only plan-performance analysis over organization-scoped membership data.
 *
 * Every database read carries `organization_id` from the AUTHORIZED tenant
 * context (never from client input). Only aggregate, plan-level figures are
 * computed — no member identity is read, returned, or sent to the provider —
 * and a membership can only influence a plan that the same organization owns.
 */
@Injectable()
export class PlanPerformanceService {
  private readonly logger = new Logger(PlanPerformanceService.name);

  constructor(
    private readonly tenantContextService: TenantContextService,
    private readonly aiService: AiService,
    @InjectRepository(Membership)
    private readonly membershipRepository: Repository<Membership>,
    @InjectRepository(MembershipPlan)
    private readonly planRepository: Repository<MembershipPlan>,
    @InjectRepository(MembershipHistory)
    private readonly historyRepository: Repository<MembershipHistory>,
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepository: Repository<TenantSettings>,
  ) {}

  async analyze(
    authorizedOrgId: string,
    userId: string,
    dto: PlanPerformanceRequestDto,
  ): Promise<PlanPerformanceResponseDto> {
    const period = resolveAnalysisWindow(dto.period ?? AI_ANALYSIS_DEFAULT_PERIOD);
    const branchId = dto.branch_id ?? null;

    let branchName: string | null = null;
    if (branchId) {
      // Defence in depth: the branch must belong to the authorized organization.
      const branch = await this.tenantContextService.requireBranchAccess(authorizedOrgId, branchId);
      branchName = branch.name;
    }

    const plans = await this.planRepository.find({
      where: { organization_id: authorizedOrgId },
      order: { created_at: 'DESC' },
      take: PLAN_PERFORMANCE_MAX_PLANS,
    });

    if (plans.length === 0) {
      return emptyResponse(
        authorizedOrgId,
        period.label,
        0,
        'No membership plans were found for this organization, so no AI analysis was performed.',
      );
    }

    // The ONLY plan identities this request may ever analyse or expose. A plan
    // from another organization can therefore never be scored, named, or
    // recommended, even if a membership somehow referenced it.
    const authorizedPlans = new Map<string, MembershipPlan>(plans.map((plan) => [plan.id, plan]));

    const memberships = await this.membershipRepository.find({
      where: branchId
        ? { organization_id: authorizedOrgId, branch_id: branchId }
        : { organization_id: authorizedOrgId },
      order: { created_at: 'DESC' },
      take: PLAN_PERFORMANCE_MAX_MEMBERSHIPS,
    });

    if (memberships.length === 0) {
      return emptyResponse(
        authorizedOrgId,
        period.label,
        plans.length,
        'No memberships matched the selected period and branch filters, so no AI analysis was performed.',
      );
    }

    const membershipsByPlan = new Map<string, Membership[]>();
    for (const membership of memberships) {
      const planId = membership.plan_id;
      if (!planId || !authorizedPlans.has(planId)) {
        // No plan, or a plan this organization does not own: counted in the
        // portfolio totals only, never attributed to a plan.
        continue;
      }
      const bucket = membershipsByPlan.get(planId);
      if (bucket) {
        bucket.push(membership);
      } else {
        membershipsByPlan.set(planId, [membership]);
      }
    }

    const lifecycleByPlan = await this.loadLifecycle(authorizedOrgId, membershipsByPlan, period);

    const planMetrics = plans.map((plan) =>
      buildPlanMetrics(
        plan,
        membershipsByPlan.get(plan.id) ?? [],
        lifecycleByPlan.get(plan.id) ?? [],
      ),
    );

    const activeMemberships = memberships.filter(
      (membership) => membership.status === STATUS_ACTIVE,
    ).length;
    const cancelledMemberships = memberships.filter(
      (membership) => membership.status === STATUS_CANCELLED,
    ).length;

    const attributedMemberships = planMetrics.reduce(
      (total, plan) => total + plan.total_memberships,
      0,
    );

    const portfolio: PlanPerformancePromptPortfolio = {
      total_plans: plans.length,
      analyzed_plans: planMetrics.filter((plan) => plan.total_memberships > 0).length,
      active_plans: plans.filter((plan) => plan.is_active).length,
      inactive_plans: plans.filter((plan) => !plan.is_active).length,
      total_memberships: memberships.length,
      active_memberships: activeMemberships,
      cancelled_memberships: cancelledMemberships,
      memberships_without_plan: memberships.length - attributedMemberships,
      overall_churn_rate: ratio(cancelledMemberships, memberships.length),
    };

    const settings = await this.tenantSettingsRepository.findOne({
      where: { organization_id: authorizedOrgId },
    });

    const payload: PlanPerformanceRequestPayload = {
      period,
      tenant: {
        organization_id: authorizedOrgId,
        time_zone: settings?.time_zone ?? null,
        locale: settings?.locale ?? null,
        currency: settings?.currency ?? null,
        branch_id: branchId,
        branch_name: branchName,
      },
      portfolio,
      plans: planMetrics,
    };

    const validated = await this.aiService.execute<ValidatedPlanPerformanceModelOutput>({
      organizationId: authorizedOrgId,
      userId,
      requestType: AI_REQUEST_TYPE_PLAN_PERFORMANCE,
      systemPrompt: PLAN_PERFORMANCE_SYSTEM_PROMPT,
      userContent: buildPlanPerformanceUserContent(payload),
      promptSummary:
        `plan-performance; period=${period.label}; branch=${branchId ?? 'all'}; ` +
        `plans=${planMetrics.length}; memberships=${memberships.length}`,
      parseModelOutput: (raw) => validatePlanPerformanceModelOutput(raw, toPlanNames(plans)),
      summarizeResult: (data) =>
        `portfolio_health=${data.portfolio_health}; recommendations=${data.recommendations.length}`,
    });

    return {
      organization_id: authorizedOrgId,
      period: period.label,
      total_plans: plans.length,
      analyzed_plans: portfolio.analyzed_plans,
      total_memberships: memberships.length,
      active_memberships: activeMemberships,
      overall_churn_rate: portfolio.overall_churn_rate,
      portfolio_health: validated.portfolio_health,
      plans: planMetrics.map(toResponsePlan),
      recommendations: validated.recommendations,
      summary: validated.summary,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Lifecycle transition counts per plan inside the period window.
   *
   * Rows are read with the authorized organization AND restricted to membership
   * ids this request already authorized, so a history row can never attach
   * another tenant's activity to a plan. `occurred_at` is bounded by the period
   * so the counts describe the same window the prompt advertises.
   */
  private async loadLifecycle(
    organizationId: string,
    membershipsByPlan: Map<string, Membership[]>,
    period: PlanPerformancePeriodInfo,
  ): Promise<Map<string, PlanPerformancePromptTransition[]>> {
    const membershipToPlan = new Map<string, string>();
    for (const [planId, memberships] of membershipsByPlan) {
      for (const membership of memberships) {
        membershipToPlan.set(membership.id, planId);
      }
    }

    if (membershipToPlan.size === 0) {
      return new Map();
    }

    const rows = await this.historyRepository.find({
      where: {
        organization_id: organizationId,
        membership_id: In(Array.from(membershipToPlan.keys())),
        occurred_at: MoreThanOrEqual(new Date(period.from)),
      },
      order: { occurred_at: 'DESC' },
      take: PLAN_PERFORMANCE_MAX_HISTORY_ROWS,
    });

    const counters = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const planId = membershipToPlan.get(row.membership_id);
      if (!planId) {
        continue;
      }
      const transition =
        typeof row.transition === 'string' && row.transition.trim() !== ''
          ? row.transition.trim().slice(0, 100)
          : row.to_status;
      const planCounters = counters.get(planId) ?? new Map<string, number>();
      planCounters.set(transition, (planCounters.get(transition) ?? 0) + 1);
      counters.set(planId, planCounters);
    }

    const result = new Map<string, PlanPerformancePromptTransition[]>();
    for (const [planId, planCounters] of counters) {
      result.set(
        planId,
        Array.from(planCounters.entries())
          .map(([transition, count]) => ({ transition, count }))
          .sort((a, b) =>
            b.count === a.count ? a.transition.localeCompare(b.transition) : b.count - a.count,
          ),
      );
    }
    return result;
  }
}

/**
 * Aggregates one plan's memberships into the metrics that are both sent to the
 * provider and returned to the caller. Pure and deterministic: the model never
 * influences any number in this function.
 */
function buildPlanMetrics(
  plan: MembershipPlan,
  memberships: Membership[],
  lifecycle: PlanPerformancePromptTransition[],
): PlanPerformancePromptPlan {
  const total = memberships.length;
  const active = memberships.filter((membership) => membership.status === STATUS_ACTIVE).length;
  const pausedOrFrozen = memberships.filter(
    (membership) => membership.status === STATUS_PAUSED || membership.status === STATUS_FROZEN,
  ).length;
  const cancelled = memberships.filter(
    (membership) => membership.status === STATUS_CANCELLED,
  ).length;

  const planPrice = toFiniteNumber(plan.price);
  let realizedDaysSum = 0;
  let realizedDaysCount = 0;
  let signupPriceSum = 0;
  let signupPriceCount = 0;
  let discountedSignups = 0;

  for (const membership of memberships) {
    const days = realizedDays(membership);
    if (days !== null) {
      realizedDaysSum += days;
      realizedDaysCount += 1;
    }
    const signupPrice = toFiniteNumber(membership.price_at_signup);
    if (signupPrice !== null) {
      signupPriceSum += signupPrice;
      signupPriceCount += 1;
      if (planPrice !== null && signupPrice < planPrice) {
        discountedSignups += 1;
      }
    }
  }

  const averageSignupPrice = signupPriceCount === 0 ? null : signupPriceSum / signupPriceCount;

  return {
    plan_id: plan.id,
    name: plan.name,
    price: planPrice ?? 0,
    currency: plan.currency,
    billing_period: plan.billing_period,
    duration_days: plan.duration_days,
    trial_days: plan.trial_days,
    is_active: plan.is_active,
    total_memberships: total,
    active_memberships: active,
    paused_or_frozen_memberships: pausedOrFrozen,
    cancelled_memberships: cancelled,
    churn_rate: ratio(cancelled, total),
    average_realized_days:
      realizedDaysCount === 0 ? null : round(realizedDaysSum / realizedDaysCount, 1),
    discounted_signups: discountedSignups,
    price_change_percent:
      averageSignupPrice === null || averageSignupPrice <= 0 || planPrice === null
        ? null
        : round(((planPrice - averageSignupPrice) / averageSignupPrice) * 100, 2),
    lifecycle,
  };
}

function toResponsePlan(plan: PlanPerformancePromptPlan): PlanPerformancePlanDto {
  return {
    plan_id: plan.plan_id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    billing_period: plan.billing_period,
    duration_days: plan.duration_days,
    trial_days: plan.trial_days,
    is_active: plan.is_active,
    total_memberships: plan.total_memberships,
    active_memberships: plan.active_memberships,
    paused_or_frozen_memberships: plan.paused_or_frozen_memberships,
    cancelled_memberships: plan.cancelled_memberships,
    churn_rate: plan.churn_rate,
    average_realized_days: plan.average_realized_days,
    discounted_signups: plan.discounted_signups,
    price_change_percent: plan.price_change_percent,
    lifecycle_transitions: plan.lifecycle,
  };
}

/** Authorized `plan_id -> name` map enforced on the untrusted model output. */
function toPlanNames(plans: MembershipPlan[]): Map<string, string> {
  return new Map(plans.map((plan) => [plan.id, plan.name]));
}

/** Nothing to analyse: never spend tokens on an empty dataset. */
function emptyResponse(
  organizationId: string,
  period: string,
  totalPlans: number,
  summary: string,
): PlanPerformanceResponseDto {
  return {
    organization_id: organizationId,
    period,
    total_plans: totalPlans,
    analyzed_plans: 0,
    total_memberships: 0,
    active_memberships: 0,
    overall_churn_rate: 0,
    portfolio_health: 0,
    plans: [],
    recommendations: [],
    summary,
    generated_at: new Date().toISOString(),
  };
}

/** Realized membership length in days, or null when the dates are unusable. */
function realizedDays(membership: Membership): number | null {
  const start = Date.parse(String(membership.start_date ?? ''));
  const end = Date.parse(String(membership.end_date ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const days = (end - start) / MS_PER_DAY;
  return days >= 0 ? days : null;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return round(numerator / denominator, 4);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}
