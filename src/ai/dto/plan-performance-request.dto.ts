import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  AI_ANALYSIS_PERIODS,
  AiAnalysisWindow,
} from '../config/ai-analysis-window';

/**
 * Supported plan-performance windows. Bounded by design (no arbitrary date
 * ranges): the window scopes the lifecycle transitions counted per plan.
 */
export const PLAN_PERFORMANCE_PERIODS = AI_ANALYSIS_PERIODS;
export type PlanPerformancePeriod = (typeof PLAN_PERFORMANCE_PERIODS)[number];

/**
 * Request body for the plan-performance endpoint.
 *
 * There is deliberately NO `organization_id` field: the tenant is always
 * derived from the authenticated principal, never from client input. There is
 * also no plan_id filter, so a caller cannot steer the analysis (and the token
 * spend) toward a single plan while the server still returns a portfolio view.
 */
export class PlanPerformanceRequestDto {
  @IsOptional()
  @IsUUID('4')
  branch_id?: string;

  @IsOptional()
  @IsIn(PLAN_PERFORMANCE_PERIODS as unknown as string[])
  period?: PlanPerformancePeriod;
}

/** Period descriptor embedded in the prompt payload. */
export type PlanPerformancePeriodInfo = AiAnalysisWindow<PlanPerformancePeriod>;

/** Non-sensitive tenant metadata embedded in the prompt payload. */
export interface PlanPerformanceTenantContext {
  organization_id: string;
  time_zone: string | null;
  locale: string | null;
  currency: string | null;
  branch_id: string | null;
  branch_name: string | null;
}

/** A single lifecycle transition count for one plan. Contains no member data. */
export interface PlanPerformancePromptTransition {
  transition: string;
  count: number;
}

/**
 * Minimal, plan-level projection sent to the provider.
 *
 * It deliberately contains NO member identity of any kind (no member_id, name,
 * phone, email, date of birth or address) and no free-text staff notes: every
 * field is either plan configuration or an aggregate count.
 */
export interface PlanPerformancePromptPlan {
  plan_id: string;
  name: string;
  price: number;
  currency: string;
  billing_period: string;
  duration_days: number;
  trial_days: number;
  is_active: boolean;
  total_memberships: number;
  active_memberships: number;
  paused_or_frozen_memberships: number;
  cancelled_memberships: number;
  churn_rate: number;
  average_realized_days: number | null;
  discounted_signups: number;
  price_change_percent: number | null;
  lifecycle: PlanPerformancePromptTransition[];
}

/** Organization-scoped totals. Aggregates only; never sums across currencies. */
export interface PlanPerformancePromptPortfolio {
  total_plans: number;
  analyzed_plans: number;
  active_plans: number;
  inactive_plans: number;
  total_memberships: number;
  active_memberships: number;
  cancelled_memberships: number;
  /** In-scope memberships with no plan, or with a plan outside this tenant. */
  memberships_without_plan: number;
  overall_churn_rate: number;
}

/**
 * Server-built prompt payload.
 *
 * Assembled exclusively from organization-scoped database rows (see
 * `PlanPerformanceService`) — never from client-supplied collections.
 */
export interface PlanPerformanceRequestPayload {
  period: PlanPerformancePeriodInfo;
  tenant: PlanPerformanceTenantContext;
  portfolio: PlanPerformancePromptPortfolio;
  plans: PlanPerformancePromptPlan[];
}
