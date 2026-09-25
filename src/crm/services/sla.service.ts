import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
  Between,
  DataSource,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Not,
  Repository,
} from "typeorm";
import { TenantContextService } from "../../shared/tenant/tenant-context.service";
import { OutboxService } from "../../shared/outbox/outbox.service";
import { FollowUp } from "../entities/follow-up.entity";
import { Lead } from "../entities/lead.entity";
import { LeadActivity } from "../entities/lead-activity.entity";
import { LeadStage } from "../entities/lead-stage.entity";
import { SlaBreach } from "../entities/sla-breach.entity";
import { SlaPolicy } from "../entities/sla-policy.entity";
import {
  CreateSlaPolicyDto,
  SlaReportQueryDto,
  UpdateSlaPolicyDto,
} from "../dto/sla.dto";
import {
  CRM_CLOSED_LEAD_STATUSES,
  CRM_EVENT_TYPES,
  CRM_EVENT_VERSION,
  CRM_FOLLOW_UP_SLA_STATUS,
  CRM_SLA_BREACH_TYPES,
  HOUR_MS,
  isBreachEscalationDue,
  isFirstResponseOverdue,
  isFollowUpOverdue,
} from "../crm.constants";

export interface SlaReport {
  organizationId: string;
  from: string | null;
  to: string | null;
  followUps: {
    total: number;
    completed: number;
    open: number;
    overdue: number;
  };
  breaches: {
    total: number;
    escalated: number;
    unresolved: number;
    byType: Record<string, number>;
  };
  /** `null` until at least one follow-up has reached a met/breached verdict. */
  complianceRate: number | null;
}

export interface DetectBreachesResult {
  followUpOverdue: number;
  firstResponse: number;
}

/**
 * P3-07 — SLA policies, compliance reporting, breach detection and escalation.
 *
 * §9 states the escalation design constraint directly: "Escalation is a state
 * change plus a notification plus an audit row. Keeping it to one write path
 * matters, so the SLA monitor should call a single service method
 * (`escalateBreach()`) that writes the breach row, updates the follow-up, and
 * publishes the event in one transaction — the same shape as the existing
 * single-write-path services."
 *
 * That is how it is built: `recordBreach` and `escalateBreach` are the only two
 * places a `CRM_SLA_BREACHES` row is written or touched, and each writes its
 * envelope through `OutboxService` on the same transaction as the domain row.
 */
@Injectable()
export class SlaService {
  constructor(
    @InjectRepository(SlaPolicy)
    private readonly policies: Repository<SlaPolicy>,
    @InjectRepository(SlaBreach)
    private readonly breaches: Repository<SlaBreach>,
    @InjectRepository(FollowUp)
    private readonly followUps: Repository<FollowUp>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadStage) private readonly stages: Repository<LeadStage>,
    @InjectRepository(LeadActivity)
    private readonly activities: Repository<LeadActivity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenant: TenantContextService,
    private readonly outbox: OutboxService,
  ) {}

  private async org(): Promise<string> {
    const id = await this.tenant.getCurrentOrganizationId();
    if (!id) throw new ForbiddenException("Organization context required");
    return id;
  }

  /** `POST /v1/sla/policies` — see `CreateSlaPolicyDto` for the O6 rationale. */
  async createPolicy(dto: CreateSlaPolicyDto): Promise<SlaPolicy> {
    const organizationId = await this.org();
    return this.policies.save(
      this.policies.create({
        organization_id: organizationId,
        name: dto.name,
        applies_to: dto.applies_to ?? null,
        first_response_hours: dto.first_response_hours,
        follow_up_interval_hours: dto.follow_up_interval_hours,
        escalation_after_hours: dto.escalation_after_hours,
        max_follow_ups_per_period: dto.max_follow_ups_per_period ?? null,
        cap_period_days: dto.cap_period_days ?? 30,
        is_active: true,
      }),
    );
  }

  /** `PATCH /v1/sla/policies/:id` — update only a policy in the current org. */
  async updatePolicy(id: string, dto: UpdateSlaPolicyDto): Promise<SlaPolicy> {
    const organizationId = await this.org();
    const policy = await this.policies.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!policy) throw new NotFoundException("SLA policy not found");

    if (dto.name !== undefined) policy.name = dto.name;
    if (dto.applies_to !== undefined) policy.applies_to = dto.applies_to;
    if (dto.first_response_hours !== undefined)
      policy.first_response_hours = dto.first_response_hours;
    if (dto.follow_up_interval_hours !== undefined) {
      policy.follow_up_interval_hours = dto.follow_up_interval_hours;
    }
    if (dto.escalation_after_hours !== undefined) {
      policy.escalation_after_hours = dto.escalation_after_hours;
    }
    if (dto.max_follow_ups_per_period !== undefined) {
      policy.max_follow_ups_per_period = dto.max_follow_ups_per_period;
    }
    if (dto.cap_period_days !== undefined)
      policy.cap_period_days = dto.cap_period_days;
    if (dto.is_active !== undefined) policy.is_active = dto.is_active;

    return this.policies.save(policy);
  }

  async listPolicies(): Promise<SlaPolicy[]> {
    return this.policies.find({
      where: { organization_id: await this.org() },
      order: { name: "ASC" },
    });
  }

  /**
   * `GET /v1/sla/reports` — "SLA compliance tracked" (backlog acceptance
   * criterion).
   *
   * Every count is scoped by the authorized `organization_id`; none of them can
   * be widened by a query parameter. `from`/`to` narrow the window (a `from`
   * later than `to` is rejected rather than silently returning zeros).
   */
  async report(dto: SlaReportQueryDto): Promise<SlaReport> {
    const organizationId = await this.org();
    const now = new Date();

    let range: { from: Date; to: Date } | null = null;
    if (dto.from || dto.to) {
      const from = dto.from ? new Date(dto.from) : new Date(0);
      const to = dto.to ? new Date(dto.to) : now;
      if (from.getTime() > to.getTime()) {
        throw new BadRequestException("`from` must not be later than `to`");
      }
      range = { from, to };
    }

    const scheduledIn = range
      ? { follow_up_date: Between(range.from, range.to) }
      : {};
    const breachedIn = range
      ? { breached_at: Between(range.from, range.to) }
      : {};

    const total = await this.followUps.count({
      where: { organization_id: organizationId, ...scheduledIn },
    });
    const completed = await this.followUps.count({
      where: {
        organization_id: organizationId,
        ...scheduledIn,
        completed_at: Not(IsNull()),
      },
    });
    // Overdue = open AND past its deadline, where the deadline is `due_at` when
    // present and `follow_up_date` otherwise — the same COALESCE the constants
    // helper applies, expressed here so the count happens in the database.
    const overdue = await this.followUps.count({
      where: [
        {
          organization_id: organizationId,
          ...scheduledIn,
          completed_at: IsNull(),
          due_at: LessThan(now),
        },
        {
          organization_id: organizationId,
          ...scheduledIn,
          completed_at: IsNull(),
          due_at: IsNull(),
          follow_up_date: LessThanOrEqual(now),
        },
      ],
    });

    const met = await this.followUps.count({
      where: {
        organization_id: organizationId,
        ...scheduledIn,
        sla_status: CRM_FOLLOW_UP_SLA_STATUS.MET,
      },
    });
    const breachedStatus = await this.followUps.count({
      where: {
        organization_id: organizationId,
        ...scheduledIn,
        sla_status: CRM_FOLLOW_UP_SLA_STATUS.BREACHED,
      },
    });

    const breachTotal = await this.breaches.count({
      where: { organization_id: organizationId, ...breachedIn },
    });
    const escalated = await this.breaches.count({
      where: {
        organization_id: organizationId,
        ...breachedIn,
        escalated_at: Not(IsNull()),
      },
    });
    const unresolved = await this.breaches.count({
      where: {
        organization_id: organizationId,
        ...breachedIn,
        resolved_at: IsNull(),
      },
    });

    const byType: Record<string, number> = {};
    for (const breachType of Object.values(CRM_SLA_BREACH_TYPES)) {
      byType[breachType] = await this.breaches.count({
        where: {
          organization_id: organizationId,
          ...breachedIn,
          breach_type: breachType,
        },
      });
    }

    const decided = met + breachedStatus;

    return {
      organizationId,
      from: range ? range.from.toISOString() : null,
      to: range ? range.to.toISOString() : null,
      followUps: { total, completed, open: total - completed, overdue },
      breaches: { total: breachTotal, escalated, unresolved, byType },
      complianceRate: decided === 0 ? null : Number((met / decided).toFixed(4)),
    };
  }

  /**
   * `CrmSlaMonitorWorker` tick — "Detect breaches, escalate, write
   * `CRM_SLA_BREACHES`" (§9).
   *
   * Cross-organization by design (a worker has no tenant context), same shape as
   * `MembershipsService.expireDueMemberships`. Idempotency — required of every new
   * worker by §14.7, which notes that "any new worker that is not idempotent must
   * add its own guard" — is provided by `recordBreach` refusing to open a second
   * unresolved breach for the same subject.
   */
  async detectBreaches(
    options: { limit?: number; now?: Date } = {},
  ): Promise<DetectBreachesResult> {
    const limit = options.limit ?? 100;
    const now = options.now ?? new Date();

    // Two branches because the deadline is `due_at` when present and
    // `follow_up_date` otherwise: a single `LessThan` cannot express the COALESCE.
    const candidates = await this.followUps.find({
      where: [
        {
          completed_at: IsNull(),
          sla_policy_id: Not(IsNull()),
          sla_status: Not(CRM_FOLLOW_UP_SLA_STATUS.BREACHED),
          due_at: LessThan(now),
        },
        {
          completed_at: IsNull(),
          sla_policy_id: Not(IsNull()),
          sla_status: Not(CRM_FOLLOW_UP_SLA_STATUS.BREACHED),
          due_at: IsNull(),
          follow_up_date: LessThan(now),
        },
      ],
      order: { follow_up_date: "ASC" },
      take: limit,
    });

    let followUpOverdue = 0;
    for (const followUp of candidates) {
      // The query above is an optimisation; this helper is the authority on the
      // deadline boundary, so the monitor cannot disagree with what `listDue`
      // reports and what `complete` treats as late.
      if (!isFollowUpOverdue(followUp, now)) continue;
      if (!followUp.sla_policy_id) continue;

      const breach = await this.recordBreach({
        organizationId: followUp.organization_id,
        policyId: followUp.sla_policy_id,
        leadId: followUp.lead_id,
        followUpId: followUp.id,
        breachType: CRM_SLA_BREACH_TYPES.FOLLOW_UP_OVERDUE,
        now,
      });
      if (breach) followUpOverdue += 1;
    }

    const firstResponse = await this.detectFirstResponseBreaches(limit, now);
    return { followUpOverdue, firstResponse };
  }

  /**
   * Leads past `first_response_hours` with nothing logged against them.
   *
   * This is the reason `CRM_SLA_BREACHES.follow_up_id` is nullable: the miss
   * belongs to the lead, not to any particular follow-up, so `follow_up_id` stays
   * null and idempotency keys on (`sla_policy_id`, `lead_id`, `breach_type`).
   */
  private async detectFirstResponseBreaches(
    limit: number,
    now: Date,
  ): Promise<number> {
    const policies = await this.policies.find({ where: { is_active: true } });
    let recorded = 0;

    for (const policy of policies) {
      if (recorded >= limit) break;

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

      const cutoff = new Date(
        now.getTime() - policy.first_response_hours * HOUR_MS,
      );
      const candidates = await this.leads.find({
        where: {
          organization_id: policy.organization_id,
          status: Not(In(CRM_CLOSED_LEAD_STATUSES)),
          created_at: LessThan(cutoff),
        },
        order: { created_at: "ASC" },
        take: limit - recorded,
      });

      for (const lead of candidates) {
        if (recorded >= limit) break;
        if (stageIds && (!lead.stage_id || !stageIds.includes(lead.stage_id)))
          continue;
        if (
          !isFirstResponseOverdue(
            lead.created_at,
            policy.first_response_hours,
            now,
          )
        )
          continue;

        const logged = await this.activities.count({
          where: { organization_id: policy.organization_id, lead_id: lead.id },
        });
        if (logged > 0) continue;

        const breach = await this.recordBreach({
          organizationId: policy.organization_id,
          policyId: policy.id,
          leadId: lead.id,
          followUpId: null,
          breachType: CRM_SLA_BREACH_TYPES.FIRST_RESPONSE,
          now,
        });
        if (breach) recorded += 1;
      }
    }

    return recorded;
  }

  /** Escalate every breach whose `escalation_after_hours` window has elapsed. */
  async escalateDueBreaches(
    options: { limit?: number; now?: Date } = {},
  ): Promise<{ escalated: number }> {
    const limit = options.limit ?? 100;
    const now = options.now ?? new Date();

    const candidates = await this.breaches.find({
      where: { escalated_at: IsNull() },
      order: { breached_at: "ASC" },
      take: limit,
    });

    let escalated = 0;
    for (const breach of candidates) {
      const policy = await this.policies.findOne({
        where: {
          id: breach.sla_policy_id,
          organization_id: breach.organization_id,
        },
      });
      if (!policy) continue;
      if (!isBreachEscalationDue(breach, policy.escalation_after_hours, now))
        continue;

      const result = await this.escalateBreach(breach.id, now);
      if (result) escalated += 1;
    }

    return { escalated };
  }

  /**
   * §9's single write path for escalation: breach row + follow-up state + event,
   * in one transaction.
   *
   * **Not reachable over HTTP.** §9's API surface defines no escalation endpoint —
   * `CrmSlaMonitorWorker` is the only caller — so this method intentionally takes a
   * bare breach id with no tenant argument, exactly as
   * `MembershipsService.expireOne` takes a bare membership id. Tenancy is not
   * absent, it is *already established*: the row was loaded by the cross-tenant
   * scan, and every write below is keyed on that row's own `organization_id`,
   * which is why a caller cannot use it to reach another tenant's data. Adding a
   * controller for it would require adding an org-scoped lookup first.
   *
   * Returns `null` when the breach was already escalated, which is what makes a
   * repeated worker tick a no-op rather than a duplicate `SlaEscalated` event.
   */
  async escalateBreach(
    breachId: string,
    now: Date = new Date(),
  ): Promise<SlaBreach | null> {
    return this.dataSource.transaction(async (manager) => {
      const breachRepository = manager.getRepository(SlaBreach);
      const breach = await breachRepository.findOne({
        where: { id: breachId },
        lock: { mode: "pessimistic_write" },
      });
      if (!breach) throw new NotFoundException("SLA breach not found");
      if (breach.escalated_at) return null;

      breach.escalated_at = now;
      const saved = await breachRepository.save(breach);

      if (breach.follow_up_id) {
        await manager.getRepository(FollowUp).update(
          {
            id: breach.follow_up_id,
            organization_id: breach.organization_id,
          },
          { escalated_at: now },
        );
      }

      await this.outbox.saveEventEnvelope(
        CRM_EVENT_TYPES.SLA_ESCALATED,
        CRM_EVENT_VERSION,
        breach.organization_id,
        {
          breachId: saved.id,
          leadId: breach.lead_id,
          organizationId: breach.organization_id,
          escalatedAt: now.toISOString(),
        },
        saved.id,
        undefined,
        manager,
      );

      return saved;
    });
  }

  /**
   * Open a breach record, set the follow-up to `breached`, and publish
   * `SlaBreached` — one transaction, so the audit row and the event cannot
   * disagree.
   *
   * Idempotent: an unresolved breach for the same subject is returned as `null`
   * instead of being duplicated. The subject is the follow-up when there is one,
   * and the lead for a first-response breach — which is exactly what the
   * `follow_up_id`-is-null case means.
   */
  private async recordBreach(input: {
    organizationId: string;
    policyId: string;
    leadId: string;
    followUpId: string | null;
    breachType: string;
    now: Date;
  }): Promise<SlaBreach | null> {
    return this.dataSource.transaction(async (manager) => {
      const breachRepository = manager.getRepository(SlaBreach);
      const existing = await breachRepository.findOne({
        where: {
          organization_id: input.organizationId,
          sla_policy_id: input.policyId,
          breach_type: input.breachType,
          resolved_at: IsNull(),
          ...(input.followUpId
            ? { follow_up_id: input.followUpId }
            : { lead_id: input.leadId, follow_up_id: IsNull() }),
        },
      });
      if (existing) return null;

      const breach = await breachRepository.save(
        breachRepository.create({
          organization_id: input.organizationId,
          sla_policy_id: input.policyId,
          lead_id: input.leadId,
          follow_up_id: input.followUpId,
          breached_at: input.now,
          breach_type: input.breachType,
        }),
      );

      if (input.followUpId) {
        await manager
          .getRepository(FollowUp)
          .update(
            { id: input.followUpId, organization_id: input.organizationId },
            { sla_status: CRM_FOLLOW_UP_SLA_STATUS.BREACHED },
          );
      }

      await this.outbox.saveEventEnvelope(
        CRM_EVENT_TYPES.SLA_BREACHED,
        CRM_EVENT_VERSION,
        input.organizationId,
        {
          breachId: breach.id,
          leadId: input.leadId,
          organizationId: input.organizationId,
          slaPolicyId: input.policyId,
          breachType: input.breachType,
          breachedAt: input.now.toISOString(),
        },
        breach.id,
        undefined,
        manager,
      );

      return breach;
    });
  }
}
