import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { Member } from '../../members/entities/member.entity';
import { Membership } from '../../memberships/entities/membership.entity';
import { MembershipPlan } from '../../memberships/entities/membership-plan.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { TenantSettings } from '../../tenancy/entities/tenant-settings.entity';
import { AiService, AI_REQUEST_TYPE_RETENTION } from './ai.service';
import {
  RetentionAnalysisRequestDto,
  RetentionAnalysisRequestPayload,
  RetentionPeriodInfo,
  RetentionPromptMember,
} from '../dto/retention-request.dto';
import {
  RetentionAnalysisResponseDto,
  ValidatedRetentionModelOutput,
  validateRetentionModelOutput,
} from '../dto/retention-response.dto';
import {
  RETENTION_MAX_RECORDS,
  RETENTION_SYSTEM_PROMPT,
  buildRetentionUserContent,
} from '../prompts/retention.prompt';
import {
  AI_ANALYSIS_DEFAULT_PERIOD,
  resolveAnalysisWindow,
} from '../config/ai-analysis-window';

const TERMINAL_STATUSES = new Set(['cancelled', 'expired']);

/**
 * Read-only retention analysis over organization-scoped membership data.
 *
 * Every database read carries `organization_id` from the AUTHORIZED tenant
 * context (never from client input), and the result set is re-validated against
 * the authorized member map before it reaches the provider or the response.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly tenantContextService: TenantContextService,
    private readonly aiService: AiService,
    @InjectRepository(Membership)
    private readonly membershipRepository: Repository<Membership>,
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(MembershipPlan)
    private readonly planRepository: Repository<MembershipPlan>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepository: Repository<TenantSettings>,
  ) {}

  async analyze(
    authorizedOrgId: string,
    userId: string,
    dto: RetentionAnalysisRequestDto,
  ): Promise<RetentionAnalysisResponseDto> {
    const period = resolveAnalysisWindow(dto.period ?? AI_ANALYSIS_DEFAULT_PERIOD);
    const branchId = dto.branch_id ?? null;

    let branchName: string | null = null;
    if (branchId) {
      // Defence in depth: the branch must belong to the authorized organization.
      const branch = await this.tenantContextService.requireBranchAccess(authorizedOrgId, branchId);
      branchName = branch.name;
    }

    const memberships = await this.membershipRepository.find({
      where: branchId
        ? { organization_id: authorizedOrgId, branch_id: branchId }
        : { organization_id: authorizedOrgId },
      order: { created_at: 'DESC' },
      take: RETENTION_MAX_RECORDS,
    });

    const relevant = memberships.filter((membership) => isRelevant(membership, period));

    const memberById = await this.loadMembers(
      authorizedOrgId,
      uniqueIds(relevant.map((membership) => membership.member_id)),
    );
    const planById = await this.loadPlans(
      authorizedOrgId,
      uniqueIds(relevant.map((membership) => membership.plan_id)),
    );
    const branchById = await this.loadBranches(
      authorizedOrgId,
      uniqueIds(relevant.map((membership) => membership.branch_id)),
    );

    // Authorized member map: the ONLY member identities this request may ever
    // expose, sent to the provider and enforced again on the model output.
    const authorizedMembers = new Map<string, string>();
    const promptMembers: RetentionPromptMember[] = [];

    for (const membership of relevant) {
      const member = memberById.get(membership.member_id);
      if (!member) {
        // Member missing, deactivated, or belonging to another organization.
        continue;
      }
      const name = displayName(member);
      authorizedMembers.set(member.id, name);
      promptMembers.push({
        member_id: member.id,
        name,
        status: membership.status,
        start_date: membership.start_date ?? null,
        end_date: membership.end_date ?? null,
        renewal_date: membership.renewal_date ?? null,
        plan_name: membership.plan_id ? planById.get(membership.plan_id)?.name ?? null : null,
        branch_name: membership.branch_id ? branchById.get(membership.branch_id)?.name ?? null : null,
      });
    }

    if (promptMembers.length === 0) {
      // Nothing to analyse: never spend tokens on an empty dataset.
      return {
        organization_id: authorizedOrgId,
        retention_rate: 0,
        total_members: 0,
        at_risk_count: 0,
        at_risk_members: [],
        summary:
          'No memberships matched the selected period and branch filters, so no AI analysis was performed.',
        generated_at: new Date().toISOString(),
      };
    }

    const settings = await this.tenantSettingsRepository.findOne({
      where: { organization_id: authorizedOrgId },
    });

    const payload: RetentionAnalysisRequestPayload = {
      period,
      tenant: {
        organization_id: authorizedOrgId,
        time_zone: settings?.time_zone ?? null,
        locale: settings?.locale ?? null,
        currency: settings?.currency ?? null,
        branch_id: branchId,
        branch_name: branchName,
      },
      memberships: promptMembers,
    };

    const validated = await this.aiService.execute<ValidatedRetentionModelOutput>({
      organizationId: authorizedOrgId,
      userId,
      requestType: AI_REQUEST_TYPE_RETENTION,
      systemPrompt: RETENTION_SYSTEM_PROMPT,
      userContent: buildRetentionUserContent(payload),
      promptSummary: `retention-analysis; period=${period.label}; branch=${branchId ?? 'all'}; memberships=${promptMembers.length}; members=${authorizedMembers.size}`,
      parseModelOutput: (raw) => validateRetentionModelOutput(raw, authorizedMembers),
      summarizeResult: (data) =>
        `retention_rate=${data.retention_rate}; at_risk=${data.at_risk_members.length}`,
    });

    return {
      organization_id: authorizedOrgId,
      retention_rate: validated.retention_rate,
      total_members: authorizedMembers.size,
      at_risk_count: validated.at_risk_members.length,
      at_risk_members: validated.at_risk_members,
      summary: validated.summary,
      generated_at: new Date().toISOString(),
    };
  }

  private async loadMembers(
    organizationId: string,
    memberIds: string[],
  ): Promise<Map<string, Member>> {
    if (memberIds.length === 0) {
      return new Map();
    }
    const members = await this.memberRepository.find({
      where: { id: In(memberIds), organization_id: organizationId, is_active: true },
    });
    return new Map(members.map((member) => [member.id, member]));
  }

  private async loadPlans(
    organizationId: string,
    planIds: string[],
  ): Promise<Map<string, MembershipPlan>> {
    if (planIds.length === 0) {
      return new Map();
    }
    const plans = await this.planRepository.find({
      where: { id: In(planIds), organization_id: organizationId },
    });
    return new Map(plans.map((plan) => [plan.id, plan]));
  }

  private async loadBranches(
    organizationId: string,
    branchIds: string[],
  ): Promise<Map<string, Branch>> {
    if (branchIds.length === 0) {
      return new Map();
    }
    const branches = await this.branchRepository.find({
      where: { id: In(branchIds), organization_id: organizationId },
    });
    return new Map(branches.map((branch) => [branch.id, branch]));
  }
}

/**
 * A membership is relevant to retention when it is still live, or when it
 * terminated inside the analysis window.
 */
function isRelevant(membership: Membership, period: RetentionPeriodInfo): boolean {
  if (!TERMINAL_STATUSES.has(String(membership.status))) {
    return true;
  }
  const terminatedAt = membership.end_date ?? membership.cancelled_at;
  if (!terminatedAt) {
    return false;
  }
  const value = terminatedAt instanceof Date ? terminatedAt.toISOString() : String(terminatedAt);
  return value >= period.from && value <= period.to;
}

function displayName(member: Member): string {
  const preferred = member.preferred_name?.trim();
  if (preferred) {
    return preferred;
  }
  return `${member.first_name} ${member.last_name}`.trim();
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
