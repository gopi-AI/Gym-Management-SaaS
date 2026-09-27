import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SlaService } from "./sla.service";
import { SlaBreach } from "../entities/sla-breach.entity";
import { FollowUp } from "../entities/follow-up.entity";
import {
  CRM_EVENT_TYPES,
  CRM_FOLLOW_UP_SLA_STATUS,
  CRM_SLA_BREACH_TYPES,
} from "../crm.constants";

describe("SlaService", () => {
  const repo = () => ({
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    update: jest.fn(),
  });

  const setup = () => {
    const policies = repo();
    const breaches = repo();
    const followUps = repo();
    const leads = repo();
    const stages = repo();
    const activities = repo();
    const outbox = {
      saveEventEnvelope: jest.fn().mockResolvedValue(undefined),
    };
    const tenant = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue("org-1"),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (manager: unknown) => unknown) =>
        callback({
          getRepository: jest.fn((entity: unknown) => {
            if (entity === SlaBreach) return breaches;
            if (entity === FollowUp) return followUps;
            return repo();
          }),
        }),
      ),
    };
    const service = new SlaService(
      policies as never,
      breaches as never,
      followUps as never,
      leads as never,
      stages as never,
      activities as never,
      dataSource as never,
      tenant as never,
      outbox as never,
    );
    return {
      service,
      policies,
      breaches,
      followUps,
      leads,
      stages,
      activities,
      outbox,
      tenant,
      dataSource,
    };
  };

  describe("policies", () => {
    it("creates the policy inside the authorized organization with documented defaults", async () => {
      const x = setup();
      x.policies.save.mockImplementation(async (value: any) => ({
        id: "policy-1",
        ...value,
      }));

      await x.service.createPolicy({
        name: "Standard",
        first_response_hours: 24,
        follow_up_interval_hours: 48,
        escalation_after_hours: 12,
      });

      expect(x.policies.create).toHaveBeenCalledWith({
        organization_id: "org-1",
        name: "Standard",
        applies_to: null,
        first_response_hours: 24,
        follow_up_interval_hours: 48,
        escalation_after_hours: 12,
        max_follow_ups_per_period: null,
        cap_period_days: 30,
        is_active: true,
      });
    });

    it("lists only the authorized organization policies", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([{ id: "policy-1" }]);

      await expect(x.service.listPolicies()).resolves.toEqual([
        { id: "policy-1" },
      ]);
      expect(x.policies.find).toHaveBeenCalledWith({
        where: { organization_id: "org-1" },
        order: { name: "ASC" },
      });
    });

    it("updates an organization-owned policy without spreading client fields", async () => {
      const x = setup();
      x.policies.findOne.mockResolvedValue({
        id: "policy-1",
        organization_id: "org-1",
        name: "Standard",
        follow_up_interval_hours: 48,
        is_active: true,
      });

      const updated = await x.service.updatePolicy("policy-1", {
        follow_up_interval_hours: 24,
        is_active: false,
      });

      expect(x.policies.findOne).toHaveBeenCalledWith({
        where: { id: "policy-1", organization_id: "org-1" },
      });
      expect(x.policies.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "policy-1",
          organization_id: "org-1",
          name: "Standard",
          follow_up_interval_hours: 24,
          is_active: false,
        }),
      );
      expect(updated.organization_id).toBe("org-1");
    });

    it("does not update a policy outside the authorized organization", async () => {
      const x = setup();
      x.policies.findOne.mockResolvedValue(null);

      await expect(
        x.service.updatePolicy("foreign-policy", { name: "Other" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(x.policies.save).not.toHaveBeenCalled();
    });
  });

  describe("report", () => {
    const wireCounts = (x: ReturnType<typeof setup>) => {
      x.followUps.count.mockImplementation(async (options: any) => {
        const where = (options as never as { where: unknown }).where;
        if (Array.isArray(where)) return 2; // overdue — two COALESCE branches
        const single = where as Record<string, unknown>;
        if (single.sla_status === CRM_FOLLOW_UP_SLA_STATUS.MET) return 4;
        if (single.sla_status === CRM_FOLLOW_UP_SLA_STATUS.BREACHED) return 1;
        if ("completed_at" in single) return 3;
        return 8; // total
      });
      x.breaches.count.mockImplementation(async (options: any) => {
        const where = (options as never as { where: Record<string, unknown> })
          .where;
        if ("escalated_at" in where) return 1;
        if ("resolved_at" in where) return 2;
        if ("breach_type" in where) {
          return where.breach_type === CRM_SLA_BREACH_TYPES.FIRST_RESPONSE
            ? 1
            : 2;
        }
        return 3;
      });
    };

    it("counts only the authorized organization and derives the compliance rate", async () => {
      const x = setup();
      wireCounts(x);

      const report = await x.service.report({});

      expect(report.organizationId).toBe("org-1");
      expect(report.from).toBeNull();
      expect(report.to).toBeNull();
      expect(report.followUps).toEqual({
        total: 8,
        completed: 3,
        open: 5,
        overdue: 2,
      });
      expect(report.breaches).toEqual({
        total: 3,
        escalated: 1,
        unresolved: 2,
        byType: {
          [CRM_SLA_BREACH_TYPES.FIRST_RESPONSE]: 1,
          [CRM_SLA_BREACH_TYPES.FOLLOW_UP_OVERDUE]: 2,
        },
      });
      // met / (met + breached) = 4 / 5
      expect(report.complianceRate).toBe(0.8);
    });

    it("scopes every count query to the authorized organization", async () => {
      const x = setup();
      wireCounts(x);
      x.tenant.getCurrentOrganizationId.mockResolvedValue("org-7");

      await x.service.report({
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T00:00:00.000Z",
      });

      const calls = [
        ...(x.followUps.count as jest.Mock).mock.calls,
        ...(x.breaches.count as jest.Mock).mock.calls,
      ].map(([options]: [any]) => options as never as { where: unknown });

      expect(calls.length).toBeGreaterThan(0);
      for (const options of calls) {
        const branches = Array.isArray(options.where)
          ? options.where
          : [options.where];
        for (const branch of branches) {
          expect((branch as Record<string, unknown>).organization_id).toBe(
            "org-7",
          );
        }
      }
    });

    it("rejects an inverted date range instead of returning a silent zero", async () => {
      const x = setup();

      await expect(
        x.service.report({
          from: "2026-04-01T00:00:00.000Z",
          to: "2026-03-01T00:00:00.000Z",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("reports a null compliance rate until something has reached a verdict", async () => {
      const x = setup();
      x.followUps.count.mockResolvedValue(0);
      x.breaches.count.mockResolvedValue(0);

      const report = await x.service.report({});

      expect(report.complianceRate).toBeNull();
      expect(report.followUps).toEqual({
        total: 0,
        completed: 0,
        open: 0,
        overdue: 0,
      });
    });
  });

  describe("detectBreaches", () => {
    const now = new Date("2026-03-01T13:00:00.000Z");
    const overdueFollowUp = (overrides: Record<string, unknown> = {}) => ({
      id: "fu-1",
      organization_id: "org-1",
      lead_id: "lead-1",
      follow_up_date: new Date("2026-03-01T09:00:00.000Z"),
      due_at: new Date("2026-03-01T12:00:00.000Z"),
      sla_policy_id: "policy-1",
      sla_status: CRM_FOLLOW_UP_SLA_STATUS.PENDING,
      completed_at: null,
      ...overrides,
    });
    const activePolicy = {
      id: "policy-1",
      organization_id: "org-1",
      applies_to: null,
      first_response_hours: 24,
      escalation_after_hours: 12,
      is_active: true,
    };
    const untouchedLead = (createdAt: Date) => ({
      id: "lead-1",
      organization_id: "org-1",
      status: "new",
      stage_id: null,
      created_at: createdAt,
    });

    it("records the breach, marks the follow-up breached and emits SlaBreached", async () => {
      const x = setup();
      x.followUps.find.mockResolvedValue([overdueFollowUp()]);
      x.policies.find.mockResolvedValue([]);
      x.breaches.findOne.mockResolvedValue(null);
      x.breaches.save.mockImplementation(async (value: any) => ({
        id: "breach-1",
        ...value,
      }));

      const result = await x.service.detectBreaches({ limit: 10, now });

      expect(result).toEqual({ followUpOverdue: 1, firstResponse: 0 });
      expect(x.breaches.create).toHaveBeenCalledWith({
        organization_id: "org-1",
        sla_policy_id: "policy-1",
        lead_id: "lead-1",
        follow_up_id: "fu-1",
        breached_at: now,
        breach_type: CRM_SLA_BREACH_TYPES.FOLLOW_UP_OVERDUE,
      });
      expect(x.followUps.update).toHaveBeenCalledWith(
        { id: "fu-1", organization_id: "org-1" },
        { sla_status: CRM_FOLLOW_UP_SLA_STATUS.BREACHED },
      );
      expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(
        CRM_EVENT_TYPES.SLA_BREACHED,
        "v1",
        "org-1",
        {
          breachId: "breach-1",
          leadId: "lead-1",
          organizationId: "org-1",
          slaPolicyId: "policy-1",
          breachType: CRM_SLA_BREACH_TYPES.FOLLOW_UP_OVERDUE,
          breachedAt: "2026-03-01T13:00:00.000Z",
        },
        "breach-1",
        undefined,
        expect.anything(),
      );
    });

    it("does not open a second breach for a subject that already has an unresolved one", async () => {
      const x = setup();
      x.followUps.find.mockResolvedValue([overdueFollowUp()]);
      x.policies.find.mockResolvedValue([]);
      x.breaches.findOne.mockResolvedValue({ id: "existing-breach" });

      const result = await x.service.detectBreaches({ limit: 10, now });

      expect(result.followUpOverdue).toBe(0);
      expect(x.breaches.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("leaves a follow-up exactly AT its deadline alone and breaches it one millisecond later", async () => {
      const atDeadline = setup();
      atDeadline.followUps.find.mockResolvedValue([
        overdueFollowUp({ due_at: now }),
      ]);
      atDeadline.policies.find.mockResolvedValue([]);
      atDeadline.breaches.findOne.mockResolvedValue(null);

      const onTime = await atDeadline.service.detectBreaches({
        limit: 10,
        now,
      });
      expect(onTime.followUpOverdue).toBe(0);
      expect(atDeadline.breaches.save).not.toHaveBeenCalled();

      const justLate = setup();
      justLate.followUps.find.mockResolvedValue([
        overdueFollowUp({ due_at: now }),
      ]);
      justLate.policies.find.mockResolvedValue([]);
      justLate.breaches.findOne.mockResolvedValue(null);
      justLate.breaches.save.mockImplementation(async (value: any) => ({
        id: "breach-1",
        ...value,
      }));

      const missed = await justLate.service.detectBreaches({
        limit: 10,
        now: new Date(now.getTime() + 1),
      });
      expect(missed.followUpOverdue).toBe(1);
    });

    it("never breaches a completed follow-up, even if a stale query handed one back", async () => {
      const x = setup();
      x.followUps.find.mockResolvedValue([
        overdueFollowUp({ completed_at: new Date("2026-03-01T12:30:00.000Z") }),
      ]);
      x.policies.find.mockResolvedValue([]);

      const result = await x.service.detectBreaches({ limit: 10, now });

      expect(result.followUpOverdue).toBe(0);
      expect(x.breaches.save).not.toHaveBeenCalled();
    });

    it("records a first-response breach with a null follow_up_id for an untouched lead", async () => {
      const x = setup();
      x.followUps.find.mockResolvedValue([]);
      x.policies.find.mockResolvedValue([activePolicy]);
      x.leads.find.mockResolvedValue([
        untouchedLead(new Date("2026-02-25T09:00:00.000Z")),
      ]);
      x.activities.count.mockResolvedValue(0);
      x.breaches.findOne.mockResolvedValue(null);
      x.breaches.save.mockImplementation(async (value: any) => ({
        id: "breach-fr",
        ...value,
      }));

      const result = await x.service.detectBreaches({ limit: 10, now });

      expect(result).toEqual({ followUpOverdue: 0, firstResponse: 1 });
      expect(x.breaches.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: "org-1",
          lead_id: "lead-1",
          follow_up_id: null,
          breach_type: CRM_SLA_BREACH_TYPES.FIRST_RESPONSE,
        }),
      );
      // A first-response breach belongs to the lead, so no follow-up is touched.
      expect(x.followUps.update).not.toHaveBeenCalled();
    });

    it("leaves a lead alone once any activity has been logged against it", async () => {
      const x = setup();
      x.followUps.find.mockResolvedValue([]);
      x.policies.find.mockResolvedValue([activePolicy]);
      x.leads.find.mockResolvedValue([
        untouchedLead(new Date("2026-02-25T09:00:00.000Z")),
      ]);
      x.activities.count.mockResolvedValue(1);

      const result = await x.service.detectBreaches({ limit: 10, now });

      expect(result.firstResponse).toBe(0);
      expect(x.breaches.save).not.toHaveBeenCalled();
    });

    it("does not breach a lead exactly at the first-response boundary", async () => {
      const x = setup();
      x.followUps.find.mockResolvedValue([]);
      x.policies.find.mockResolvedValue([activePolicy]);
      // Exactly 24h old at `now`, which is the boundary itself.
      x.leads.find.mockResolvedValue([
        untouchedLead(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      ]);
      x.activities.count.mockResolvedValue(0);

      const result = await x.service.detectBreaches({ limit: 10, now });

      expect(result.firstResponse).toBe(0);
      expect(x.breaches.save).not.toHaveBeenCalled();
    });
  });

  describe("escalation", () => {
    const now = new Date("2026-03-01T13:00:00.000Z");
    const breach = (overrides: Record<string, unknown> = {}) => ({
      id: "breach-1",
      organization_id: "org-1",
      sla_policy_id: "policy-1",
      lead_id: "lead-1",
      follow_up_id: "fu-1",
      breached_at: new Date("2026-03-01T12:00:00.000Z"),
      breach_type: CRM_SLA_BREACH_TYPES.FOLLOW_UP_OVERDUE,
      escalated_at: null,
      resolved_at: null,
      ...overrides,
    });
    const policy = {
      id: "policy-1",
      organization_id: "org-1",
      escalation_after_hours: 2,
      is_active: true,
    };

    it("escalates a breach whose window has elapsed and emits SlaEscalated", async () => {
      const x = setup();
      const workerNow = new Date("2026-03-01T15:00:00.000Z"); // 12:00 + 2h = 14:00
      x.breaches.find.mockResolvedValue([breach()]);
      x.policies.findOne.mockResolvedValue(policy);
      x.breaches.findOne.mockResolvedValue(breach());

      const result = await x.service.escalateDueBreaches({
        limit: 10,
        now: workerNow,
      });

      expect(result).toEqual({ escalated: 1 });
      expect(x.policies.findOne).toHaveBeenCalledWith({
        where: { id: "policy-1", organization_id: "org-1" },
      });
      expect(x.followUps.update).toHaveBeenCalledWith(
        { id: "fu-1", organization_id: "org-1" },
        { escalated_at: workerNow },
      );
      expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(
        CRM_EVENT_TYPES.SLA_ESCALATED,
        "v1",
        "org-1",
        {
          breachId: "breach-1",
          leadId: "lead-1",
          organizationId: "org-1",
          escalatedAt: "2026-03-01T15:00:00.000Z",
        },
        "breach-1",
        undefined,
        expect.anything(),
      );
    });

    it("does not escalate exactly AT the boundary, only one millisecond after it", async () => {
      const atBoundary = setup();
      atBoundary.breaches.find.mockResolvedValue([breach()]);
      atBoundary.policies.findOne.mockResolvedValue(policy);

      await expect(
        atBoundary.service.escalateDueBreaches({
          limit: 10,
          now: new Date("2026-03-01T14:00:00.000Z"),
        }),
      ).resolves.toEqual({ escalated: 0 });
      expect(atBoundary.breaches.save).not.toHaveBeenCalled();

      const justAfter = setup();
      justAfter.breaches.find.mockResolvedValue([breach()]);
      justAfter.policies.findOne.mockResolvedValue(policy);
      justAfter.breaches.findOne.mockResolvedValue(breach());

      await expect(
        justAfter.service.escalateDueBreaches({
          limit: 10,
          now: new Date("2026-03-01T14:00:00.001Z"),
        }),
      ).resolves.toEqual({ escalated: 1 });
      expect(justAfter.outbox.saveEventEnvelope).toHaveBeenCalledTimes(1);
    });

    it("is idempotent — an already escalated breach is never escalated twice", async () => {
      const x = setup();
      x.breaches.find.mockResolvedValue([
        breach({ escalated_at: new Date("2026-03-01T14:30:00.000Z") }),
      ]);
      x.policies.findOne.mockResolvedValue(policy);

      await expect(
        x.service.escalateDueBreaches({ limit: 10, now }),
      ).resolves.toEqual({
        escalated: 0,
      });
      expect(x.breaches.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("skips a breach whose policy is gone rather than escalating blind", async () => {
      const x = setup();
      x.breaches.find.mockResolvedValue([breach()]);
      x.policies.findOne.mockResolvedValue(null);

      await expect(
        x.service.escalateDueBreaches({ limit: 10, now }),
      ).resolves.toEqual({
        escalated: 0,
      });
      expect(x.breaches.save).not.toHaveBeenCalled();
    });

    it("escalateBreach returns null on a repeat call, so a second tick writes nothing", async () => {
      const x = setup();
      x.breaches.findOne.mockResolvedValue(
        breach({ escalated_at: new Date("2026-03-01T14:00:00.000Z") }),
      );

      await expect(
        x.service.escalateBreach("breach-1", now),
      ).resolves.toBeNull();
      expect(x.breaches.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("escalateBreach throws for an unknown breach id", async () => {
      const x = setup();
      x.breaches.findOne.mockResolvedValue(null);

      await expect(
        x.service.escalateBreach("missing", now),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(x.breaches.save).not.toHaveBeenCalled();
    });
  });
});
