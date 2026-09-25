import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from "typeorm";
import { TenantContextService } from "../../shared/tenant/tenant-context.service";
import { OutboxService } from "../../shared/outbox/outbox.service";
import { FollowUp } from "../entities/follow-up.entity";
import { Lead } from "../entities/lead.entity";
import { LeadStage } from "../entities/lead-stage.entity";
import { SlaPolicy } from "../entities/sla-policy.entity";
import {
  CompleteFollowUpDto,
  CreateFollowUpDto,
  ListDueFollowUpsDto,
} from "../dto/follow-up.dto";
import {
  CRM_CLOSED_LEAD_STATUSES,
  CRM_EVENT_TYPES,
  CRM_EVENT_VERSION,
  CRM_FOLLOW_UP_SLA_STATUS,
  followUpDeadline,
  HOUR_MS,
  isFollowUpOverdue,
} from "../crm.constants";

/** A due-list row carries the derived overdue flag so clients need not re-derive it. */
export interface DueFollowUp extends FollowUp {
  overdue: boolean;
}

export interface GenerateFollowUpsResult {
  scanned: number;
  generated: number;
  policies: number;
}

/**
 * P3-07 — follow-up scheduling, completion and generation.
 *
 * Two distinct entry points live here on purpose:
 *
 *   - **Request-scoped** (`schedule`, `complete`, `listDue`) resolve the
 *     organization from `TenantContextService` and can only ever see one tenant's
 *     rows — the same shape as `crm.service.ts`.
 *   - **Worker-scoped** (`generateFollowUps`) spans organizations, because a
 *     background worker has no request context. It follows
 *     `MembershipsService.expireDueMemberships`: the scan itself is deliberately
 *     cross-tenant, but every write it performs carries the `organization_id` of
 *     the row it is acting on, and it is idempotent so a repeated tick cannot
 *     duplicate work. It is never reachable over HTTP — `CrmFollowUpsWorker` is
 *     its only caller.
 */
@Injectable()
export class FollowUpsService {
  constructor(
    @InjectRepository(FollowUp)
    private readonly followUps: Repository<FollowUp>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadStage) private readonly stages: Repository<LeadStage>,
    @InjectRepository(SlaPolicy)
    private readonly policies: Repository<SlaPolicy>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenant: TenantContextService,
    private readonly outbox: OutboxService,
  ) {}

  private async org(): Promise<string> {
    const id = await this.tenant.getCurrentOrganizationId();
    if (!id) throw new ForbiddenException("Organization context required");
    return id;
  }

  /**
   * The only way a lead is reached from a request. Scoping the lookup by
   * `organization_id` is what makes the tenant boundary hold: a lead id from
   * another organization is indistinguishable from a nonexistent one.
   */
  private async lead(id: string, org: string): Promise<Lead> {
    const lead = await this.leads.findOne({
      where: { id, organization_id: org },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  /**
   * Resolve an SLA policy the caller is allowed to attach. Both checks are
   * authorization checks, not validation: another organization's policy id must
   * never be attachable, and an inactive policy must not silently keep applying.
   */
  private async attachablePolicy(id: string, org: string): Promise<SlaPolicy> {
    const policy = await this.policies.findOne({
      where: { id, organization_id: org },
    });
    if (!policy)
      throw new ForbiddenException(
        "SLA policy is not in the authorized organization",
      );
    if (!policy.is_active)
      throw new BadRequestException("SLA policy is not active");
    return policy;
  }

  /** `POST /v1/leads/{id}/follow-ups` — schedule a follow-up against a lead. */
  async schedule(leadId: string, dto: CreateFollowUpDto): Promise<FollowUp> {
    const organizationId = await this.org();
    const lead = await this.lead(leadId, organizationId);
    const policy = dto.sla_policy_id
      ? await this.attachablePolicy(dto.sla_policy_id, organizationId)
      : null;

    const followUpDate = new Date(dto.follow_up_date);
    if (Number.isNaN(followUpDate.getTime())) {
      throw new BadRequestException("follow_up_date is not a valid date");
    }
    if (policy && (await this.capReached(policy, lead.id, new Date()))) {
      throw new ConflictException(
        "Follow-up cap reached for this lead and policy period",
      );
    }

    return this.insertFollowUp({
      organizationId,
      leadId: lead.id,
      followUpDate,
      slaPolicyId: policy?.id ?? null,
      intervalHours: policy?.follow_up_interval_hours ?? null,
    });
  }

  /**
   * `POST /v1/follow-ups/{id}/complete` — record the outcome and close the
   * follow-up.
   *
   * The row is read under a pessimistic write lock inside the transaction, so two
   * concurrent completions cannot both pass the "already completed" check and
   * write two events. Tardiness is decided by {@link isFollowUpOverdue} with
   * `completed_at` masked to null, which reuses the one boundary rule the SLA
   * monitor uses rather than introducing a second, subtly different comparison.
   */
  async complete(id: string, dto: CompleteFollowUpDto): Promise<FollowUp> {
    const organizationId = await this.org();

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(FollowUp);
      const followUp = await repository.findOne({
        where: { id, organization_id: organizationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!followUp) throw new NotFoundException("Follow-up not found");
      if (followUp.completed_at) {
        throw new ConflictException("Follow-up has already been completed");
      }
      const outcome = dto.outcome.trim();
      if (!outcome)
        throw new BadRequestException(
          "A non-empty follow-up outcome is required",
        );

      const completedAt = new Date();
      const late = isFollowUpOverdue(
        { ...followUp, completed_at: null },
        completedAt,
      );

      followUp.outcome = outcome;
      followUp.completed_at = completedAt;
      followUp.sla_status = late
        ? CRM_FOLLOW_UP_SLA_STATUS.BREACHED
        : CRM_FOLLOW_UP_SLA_STATUS.MET;

      const saved = await repository.save(followUp);

      await this.outbox.saveEventEnvelope(
        CRM_EVENT_TYPES.FOLLOW_UP_COMPLETED,
        CRM_EVENT_VERSION,
        organizationId,
        {
          followUpId: saved.id,
          leadId: saved.lead_id,
          organizationId,
          outcome,
          completedAt: completedAt.toISOString(),
        },
        saved.id,
        undefined,
        manager,
      );

      return saved;
    });
  }

  /**
   * `GET /v1/follow-ups/due` — due and overdue follow-ups for the authorized
   * organization, ordered most-urgent first.
   *
   * "Due" is `follow_up_date` (when staff should act); `overdue` additionally
   * reports the SLA deadline verdict. `withinHours` widens the window to include
   * work that is about to become due, which is what a front-desk queue actually
   * needs; the default of 0 returns only what is actionable right now.
   */
  async listDue(dto: ListDueFollowUpsDto): Promise<{
    data: DueFollowUp[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.org();
    const now = new Date();
    const horizon = new Date(now.getTime() + dto.withinHours * HOUR_MS);

    const [rows, total] = await this.followUps.findAndCount({
      where: {
        organization_id: organizationId,
        completed_at: IsNull(),
        follow_up_date: LessThanOrEqual(horizon),
      },
      order: { follow_up_date: "ASC" },
      take: dto.limit,
      skip: (dto.page - 1) * dto.limit,
    });

    return {
      data: rows.map((row) => ({
        ...row,
        overdue: isFollowUpOverdue(row, now),
      })),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  /**
   * `CrmFollowUpsWorker` tick — "Generate follow-ups per policy" (§9).
   *
   * Cross-organization by design (a worker has no tenant context). Idempotency,
   * which §14.7 requires of every new worker, comes from two guards: a lead that
   * already has an open follow-up is skipped, and §9's follow-up-fatigue cap stops
   * a policy from exceeding its quota per lead per period.
   */
  async generateFollowUps(
    options: { limit?: number; now?: Date } = {},
  ): Promise<GenerateFollowUpsResult> {
    const limit = options.limit ?? 100;
    const now = options.now ?? new Date();

    const policies = await this.policies.find({ where: { is_active: true } });
    let scanned = 0;
    let generated = 0;

    for (const policy of policies) {
      if (generated >= limit) break;

      // `applies_to` narrows the policy to one lead-stage key; resolving it once
      // per policy keeps the per-lead loop free of extra queries.
      const stageIds = policy.applies_to
        ? (
            await this.stages.find({
              where: {
                organization_id: policy.organization_id,
                key: policy.applies_to,
              },
            })
          ).map((stage) => stage.id)
        : null;

      const candidates = await this.leads.find({
        where: {
          organization_id: policy.organization_id,
          status: Not(In(CRM_CLOSED_LEAD_STATUSES)),
        },
        order: { created_at: "ASC" },
        take: limit - generated,
      });

      for (const lead of candidates) {
        if (generated >= limit) break;
        scanned += 1;

        if (stageIds && (!lead.stage_id || !stageIds.includes(lead.stage_id)))
          continue;
        if (await this.hasOpenFollowUp(policy.organization_id, lead.id))
          continue;
        if (await this.capReached(policy, lead.id, now)) continue;

        const followUpDate = new Date(
          now.getTime() + policy.follow_up_interval_hours * HOUR_MS,
        );
        await this.insertFollowUp({
          organizationId: policy.organization_id,
          leadId: lead.id,
          followUpDate,
          slaPolicyId: policy.id,
          intervalHours: policy.follow_up_interval_hours,
        });
        generated += 1;
      }
    }

    return { scanned, generated, policies: policies.length };
  }

  /**
   * The single write path for a follow-up.
   *
   * The row and its `FollowUpScheduled` envelope are written on the same
   * transaction/connection, so a failure cannot leave an event for a follow-up
   * that was never stored (`.clinerules`: never publish directly, and outbox rows
   * travel with the domain write).
   */
  private async insertFollowUp(input: {
    organizationId: string;
    leadId: string;
    followUpDate: Date;
    slaPolicyId: string | null;
    intervalHours: number | null;
  }): Promise<FollowUp> {
    const dueAt = followUpDeadline(input.followUpDate, input.intervalHours);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(FollowUp);
      const followUp = await repository.save(
        repository.create({
          organization_id: input.organizationId,
          lead_id: input.leadId,
          follow_up_date: input.followUpDate,
          due_at: dueAt,
          sla_policy_id: input.slaPolicyId,
          sla_status: CRM_FOLLOW_UP_SLA_STATUS.PENDING,
        }),
      );

      await this.outbox.saveEventEnvelope(
        CRM_EVENT_TYPES.FOLLOW_UP_SCHEDULED,
        CRM_EVENT_VERSION,
        input.organizationId,
        {
          followUpId: followUp.id,
          leadId: input.leadId,
          organizationId: input.organizationId,
          dueAt: dueAt.toISOString(),
          slaPolicyId: input.slaPolicyId,
        },
        followUp.id,
        undefined,
        manager,
      );

      return followUp;
    });
  }

  /** Idempotency guard: does this lead already have an uncompleted follow-up? */
  private async hasOpenFollowUp(
    organizationId: string,
    leadId: string,
  ): Promise<boolean> {
    const open = await this.followUps.count({
      where: {
        organization_id: organizationId,
        lead_id: leadId,
        completed_at: IsNull(),
      },
    });
    return open > 0;
  }

  /** §9 "Follow-up fatigue": a policy may cap follow-ups per lead per period. */
  private async capReached(
    policy: SlaPolicy,
    leadId: string,
    now: Date,
  ): Promise<boolean> {
    const cap = policy.max_follow_ups_per_period;
    if (cap == null) return false;

    const since = new Date(
      now.getTime() - policy.cap_period_days * 24 * HOUR_MS,
    );
    const used = await this.followUps.count({
      where: {
        organization_id: policy.organization_id,
        lead_id: leadId,
        created_at: MoreThanOrEqual(since),
      },
    });
    return used >= cap;
  }
}
