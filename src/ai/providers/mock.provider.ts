import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiProviderError,
  AiRequest,
  AiResponse,
} from '../services/ai-provider.service';
import {
  PLAN_PERFORMANCE_MAX_RECOMMENDATIONS,
  PLAN_PERFORMANCE_TASK,
} from '../prompts/plan-performance.prompt';

const MAX_AT_RISK = 50;
const RISK_SCORE_BY_STATUS: Record<string, number> = {
  cancelled: 0.9,
  expired: 0.85,
  paused: 0.6,
  frozen: 0.55,
  active: 0.2,
};
const AT_RISK_THRESHOLD = 0.5;
const RENEWAL_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

interface MockMemberEntry {
  member_id?: unknown;
  name?: unknown;
  status?: unknown;
  renewal_date?: unknown;
  end_date?: unknown;
}

/**
 * Deterministic, offline stand-in for a real provider.
 *
 * Purpose: (a) local development and (b) automated tests without network or
 * API cost. It deliberately refuses to run under `NODE_ENV=production`, so a
 * misconfigured deployment can never silently serve fabricated AI output.
 */
@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock-deterministic-v1';

  constructor(private readonly config: ConfigService) {}

  async generate(request: AiRequest): Promise<AiResponse> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new AiProviderError(
        'AI_NOT_CONFIGURED',
        'The mock AI provider is not available in production',
        { retryable: false },
      );
    }

    const startedAt = Date.now();
    const payload = this.parseJson(request.userContent);

    // The task is a server-owned payload field, so the mock (like a real model)
    // is driven by the declared use case rather than by guesswork.
    const content =
      payload.task === PLAN_PERFORMANCE_TASK
        ? this.buildPlanPerformanceContent(payload)
        : this.buildRetentionContent(payload);

    return {
      content,
      provider: this.name,
      model: this.model,
      inputTokens: Math.ceil(request.userContent.length / 4),
      outputTokens: Math.ceil(content.length / 4),
      totalTokens: Math.ceil((request.userContent.length + content.length) / 4),
      latencyMs: Date.now() - startedAt,
    };
  }

  private buildRetentionContent(payload: Record<string, unknown>): string {
    const memberships = this.retentionMemberships(payload);

    const scored = memberships
      .map((entry) => ({
        member_id: typeof entry.member_id === 'string' ? entry.member_id : '',
        name: typeof entry.name === 'string' ? entry.name : 'Unknown member',
        status: typeof entry.status === 'string' ? entry.status : 'unknown',
        score: this.score(entry),
      }))
      .filter((entry) => entry.member_id !== '');

    const atRisk = scored
      .filter((entry) => entry.score >= AT_RISK_THRESHOLD)
      .sort((a, b) => (b.score === a.score ? a.member_id.localeCompare(b.member_id) : b.score - a.score))
      .slice(0, MAX_AT_RISK);

    const activeCount = scored.filter((entry) => entry.status === 'active').length;
    const totalMembers = scored.length;
    const retentionRate = totalMembers === 0 ? 0 : Math.round((activeCount / totalMembers) * 100) / 100;

    const content = JSON.stringify({
      retention_rate: retentionRate,
      total_members: totalMembers,
      at_risk_count: atRisk.length,
      at_risk_members: atRisk.map((entry) => ({
        member_id: entry.member_id,
        name: entry.name,
        risk_score: entry.score,
        risk_factors: this.factors(entry.status, entry.score),
        recommended_action: this.action(entry.status),
      })),
      summary:
        `Mock analysis over ${totalMembers} membership record(s): ` +
        `${activeCount} active, ${atRisk.length} flagged at risk ` +
        `(deterministic estimate; no external model was called).`,
    });

    return content;
  }

  /**
   * Deterministic plan-portfolio stand-in.
   *
   * Every value is derived from the aggregate payload the service built, so the
   * mock can neither invent a plan nor leak member data (it never receives any).
   */
  private buildPlanPerformanceContent(payload: Record<string, unknown>): string {
    const data = payload.data as { plans?: unknown; portfolio?: unknown } | undefined;
    const plans = data?.plans;
    if (!Array.isArray(plans)) {
      throw new AiProviderError(
        'AI_INVALID_REQUEST',
        'Mock provider received a payload without data.plans',
        { retryable: false },
      );
    }

    const portfolio = (data?.portfolio ?? {}) as MockPortfolioEntry;
    const total = numberOrZero(portfolio.total_memberships);
    const active = numberOrZero(portfolio.active_memberships);
    const portfolioHealth = total === 0 ? 0 : Math.round((active / total) * 100) / 100;

    const recommendations = plans
      .map((entry) => toPlanCandidate(entry))
      .filter((candidate): candidate is PlanCandidate => candidate !== null)
      .sort(compareCandidates)
      .slice(0, PLAN_PERFORMANCE_MAX_RECOMMENDATIONS)
      .map((candidate) => ({
        plan_id: candidate.planId,
        priority: candidate.priority,
        issue: candidate.issue,
        recommended_action: candidate.action,
      }));

    return JSON.stringify({
      portfolio_health: portfolioHealth,
      recommendations,
      summary:
        `Mock portfolio review over ${plans.length} plan(s) and ${total} membership record(s): ` +
        `${recommendations.length} plan(s) flagged ` +
        '(deterministic estimate; no external model was called).',
    });
  }

  private parseJson(userContent: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(userContent);
    } catch {
      throw new AiProviderError('AI_INVALID_REQUEST', 'Mock provider received invalid JSON', {
        retryable: false,
      });
    }
    return (parsed ?? {}) as Record<string, unknown>;
  }

  private retentionMemberships(payload: Record<string, unknown>): MockMemberEntry[] {
    const memberships = (payload.data as { memberships?: unknown } | undefined)?.memberships;
    if (!Array.isArray(memberships)) {
      throw new AiProviderError(
        'AI_INVALID_REQUEST',
        'Mock provider received a payload without data.memberships',
        { retryable: false },
      );
    }
    return memberships as MockMemberEntry[];
  }

  private score(entry: MockMemberEntry): number {
    const status = typeof entry.status === 'string' ? entry.status : '';
    let score = RISK_SCORE_BY_STATUS[status] ?? 0.4;
    const days = daysUntil(entry.renewal_date ?? entry.end_date);
    if (days !== null && days <= RENEWAL_WINDOW_DAYS) {
      score += 0.15;
    }
    return Math.round(Math.min(score, 1) * 100) / 100;
  }

  private factors(status: string, score: number): string[] {
    const factors: string[] = [];
    if (status !== 'active') {
      factors.push(`membership status is "${status}"`);
    }
    if (score >= 0.85) {
      factors.push('high churn signal for this status');
    }
    if (factors.length === 0) {
      factors.push('low engagement signal');
    }
    return factors;
  }

  private action(status: string): string {
    switch (status) {
      case 'cancelled':
      case 'expired':
        return 'Trigger a win-back outreach with a renewal offer.';
      case 'paused':
      case 'frozen':
        return 'Ask the member to confirm a restart date and offer a plan adjustment.';
      default:
        return 'Monitor engagement and confirm the upcoming renewal.';
    }
  }
}

function daysUntil(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const target = Date.parse(value);
  if (!Number.isFinite(target)) {
    return null;
  }
  return Math.floor((target - Date.now()) / MS_PER_DAY);
}

interface MockPortfolioEntry {
  total_memberships?: unknown;
  active_memberships?: unknown;
}

interface PlanCandidate {
  planId: string;
  priority: 'high' | 'medium' | 'low';
  issue: string;
  action: string;
  churnRate: number;
}

/**
 * Maps one payload plan to a deterministic recommendation, or null when the
 * plan's aggregates do not justify one. Priority order is fixed so the mock's
 * output stays reproducible for tests and development.
 */
function toPlanCandidate(entry: unknown): PlanCandidate | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const plan = entry as Record<string, unknown>;
  const planId = typeof plan.plan_id === 'string' ? plan.plan_id : '';
  if (planId === '') {
    return null;
  }

  const total = numberOrZero(plan.total_memberships);
  const churnRate = numberOrZero(plan.churn_rate);
  const discounted = numberOrZero(plan.discounted_signups);
  const isActive = plan.is_active !== false;

  if (total === 0) {
    return {
      planId,
      priority: 'low',
      issue: 'Plan currently has no memberships',
      action: 'Promote the plan with a launch offer, or retire it if it stays unused.',
      churnRate,
    };
  }
  if (churnRate >= 0.5) {
    return {
      planId,
      priority: 'high',
      issue: `High churn rate (${Math.round(churnRate * 100)}%) across ${total} membership(s)`,
      action: 'Review price and benefits with the members who cancelled this plan.',
      churnRate,
    };
  }
  if (!isActive) {
    return {
      planId,
      priority: 'medium',
      issue: `Plan is inactive but still holds ${total} membership(s)`,
      action: 'Decide whether to reactivate the plan or migrate its remaining members.',
      churnRate,
    };
  }
  if (discounted > 0) {
    return {
      planId,
      priority: 'medium',
      issue: `${discounted} membership(s) started below the current plan price`,
      action: 'Align the current price with the price members actually accepted.',
      churnRate,
    };
  }
  return null;
}

const MOCK_PRIORITY_RANK: Record<PlanCandidate['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function compareCandidates(a: PlanCandidate, b: PlanCandidate): number {
  if (a.priority !== b.priority) {
    return MOCK_PRIORITY_RANK[a.priority] - MOCK_PRIORITY_RANK[b.priority];
  }
  if (a.churnRate !== b.churnRate) {
    return b.churnRate - a.churnRate;
  }
  return a.planId.localeCompare(b.planId);
}

function numberOrZero(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 0;
}

