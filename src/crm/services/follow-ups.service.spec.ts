import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { FollowUpsService } from "./follow-ups.service";
import { FollowUp } from "../entities/follow-up.entity";
import { CRM_EVENT_TYPES, CRM_FOLLOW_UP_SLA_STATUS } from "../crm.constants";

describe("FollowUpsService", () => {
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
    const followUps = repo();
    const leads = repo();
    const stages = repo();
    const policies = repo();
    const outbox = {
      saveEventEnvelope: jest.fn().mockResolvedValue(undefined),
    };
    const tenant = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue("org-1"),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (manager: unknown) => unknown) =>
        callback({
          getRepository: jest.fn((entity: unknown) =>
            entity === FollowUp ? followUps : repo(),
          ),
        }),
      ),
    };
    const service = new FollowUpsService(
      followUps as never,
      leads as never,
      stages as never,
      policies as never,
      dataSource as never,
      tenant as never,
      outbox as never,
    );
    return {
      service,
      followUps,
      leads,
      stages,
      policies,
      outbox,
      tenant,
      dataSource,
    };
  };

  describe("schedule", () => {
    it("scopes the lead lookup to the authorized organization and emits FollowUpScheduled", async () => {
      const x = setup();
      x.leads.findOne.mockResolvedValue({
        id: "lead-1",
        organization_id: "org-1",
      });
      x.policies.findOne.mockResolvedValue({
        id: "policy-1",
        organization_id: "org-1",
        is_active: true,
        follow_up_interval_hours: 4,
      });
      x.followUps.save.mockImplementation(async (value: any) => ({
        id: "fu-1",
        ...value,
      }));

      const result = await x.service.schedule("lead-1", {
        follow_up_date: "2026-03-01T09:00:00.000Z",
        sla_policy_id: "policy-1",
      } as never);

      expect(x.leads.findOne).toHaveBeenCalledWith({
        where: { id: "lead-1", organization_id: "org-1" },
      });
      expect(x.policies.findOne).toHaveBeenCalledWith({
        where: { id: "policy-1", organization_id: "org-1" },
      });
      expect(x.followUps.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: "org-1",
          lead_id: "lead-1",
          sla_policy_id: "policy-1",
          sla_status: CRM_FOLLOW_UP_SLA_STATUS.PENDING,
          follow_up_date: new Date("2026-03-01T09:00:00.000Z"),
          due_at: new Date("2026-03-01T13:00:00.000Z"),
        }),
      );
      expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(
        CRM_EVENT_TYPES.FOLLOW_UP_SCHEDULED,
        "v1",
        "org-1",
        {
          followUpId: "fu-1",
          leadId: "lead-1",
          organizationId: "org-1",
          dueAt: "2026-03-01T13:00:00.000Z",
          slaPolicyId: "policy-1",
        },
        "fu-1",
        undefined,
        expect.anything(),
      );
      expect(result.id).toBe("fu-1");
    });

    it("leaves due_at equal to follow_up_date when no policy is attached", async () => {
      const x = setup();
      x.leads.findOne.mockResolvedValue({
        id: "lead-1",
        organization_id: "org-1",
      });
      x.followUps.save.mockImplementation(async (value: any) => ({
        id: "fu-1",
        ...value,
      }));

      await x.service.schedule("lead-1", {
        follow_up_date: "2026-03-01T09:00:00.000Z",
      } as never);

      expect(x.followUps.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sla_policy_id: null,
          due_at: new Date("2026-03-01T09:00:00.000Z"),
        }),
      );
      expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(
        CRM_EVENT_TYPES.FOLLOW_UP_SCHEDULED,
        "v1",
        "org-1",
        expect.objectContaining({
          dueAt: "2026-03-01T09:00:00.000Z",
          slaPolicyId: null,
        }),
        "fu-1",
        undefined,
        expect.anything(),
      );
    });

    it("refuses a lead belonging to another organization without writing anything", async () => {
      const x = setup();
      x.leads.findOne.mockResolvedValue(null);

      await expect(
        x.service.schedule("other-lead", {
          follow_up_date: "2026-03-01T09:00:00.000Z",
        } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(x.followUps.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("refuses an SLA policy belonging to another organization", async () => {
      const x = setup();
      x.leads.findOne.mockResolvedValue({
        id: "lead-1",
        organization_id: "org-1",
      });
      x.policies.findOne.mockResolvedValue(null);

      await expect(
        x.service.schedule("lead-1", {
          follow_up_date: "2026-03-01T09:00:00.000Z",
          sla_policy_id: "other-org-policy",
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(x.followUps.save).not.toHaveBeenCalled();
    });

    it("refuses an inactive policy rather than attaching one that no longer applies", async () => {
      const x = setup();
      x.leads.findOne.mockResolvedValue({
        id: "lead-1",
        organization_id: "org-1",
      });
      x.policies.findOne.mockResolvedValue({
        id: "policy-1",
        organization_id: "org-1",
        is_active: false,
        follow_up_interval_hours: 4,
      });

      await expect(
        x.service.schedule("lead-1", {
          follow_up_date: "2026-03-01T09:00:00.000Z",
          sla_policy_id: "policy-1",
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(x.followUps.save).not.toHaveBeenCalled();
    });

    it("rejects manual scheduling when the attached policy follow-up cap is reached", async () => {
      const x = setup();
      x.leads.findOne.mockResolvedValue({
        id: "lead-1",
        organization_id: "org-1",
      });
      x.policies.findOne.mockResolvedValue({
        id: "policy-1",
        organization_id: "org-1",
        is_active: true,
        follow_up_interval_hours: 4,
        max_follow_ups_per_period: 2,
        cap_period_days: 30,
      });
      x.followUps.count.mockResolvedValue(2);

      await expect(
        x.service.schedule("lead-1", {
          follow_up_date: "2026-03-01T09:00:00.000Z",
          sla_policy_id: "policy-1",
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(x.followUps.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organization_id: "org-1",
          lead_id: "lead-1",
          created_at: expect.anything(),
        }),
      });
      expect(x.followUps.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("rejects an unparseable follow_up_date", async () => {
      const x = setup();
      x.leads.findOne.mockResolvedValue({
        id: "lead-1",
        organization_id: "org-1",
      });

      await expect(
        x.service.schedule("lead-1", { follow_up_date: "not-a-date" } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(x.followUps.save).not.toHaveBeenCalled();
    });

    it("requires an organization context", async () => {
      const x = setup();
      x.tenant.getCurrentOrganizationId.mockResolvedValue(null);

      await expect(
        x.service.schedule("lead-1", {
          follow_up_date: "2026-03-01T09:00:00.000Z",
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("complete", () => {
    const openFollowUp = (overrides: Record<string, unknown> = {}) => ({
      id: "fu-1",
      organization_id: "org-1",
      lead_id: "lead-1",
      follow_up_date: new Date("2026-03-01T09:00:00.000Z"),
      due_at: new Date("2026-03-01T13:00:00.000Z"),
      sla_status: CRM_FOLLOW_UP_SLA_STATUS.PENDING,
      outcome: null,
      completed_at: null,
      ...overrides,
    });

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("records the outcome as met and emits FollowUpCompleted before the deadline", async () => {
      const x = setup();
      jest.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
      x.followUps.findOne.mockResolvedValue(openFollowUp());
      x.followUps.save.mockImplementation(async (value: any) => value);

      const result = await x.service.complete("fu-1", {
        outcome: "Called, wants a callback",
      });

      expect(x.followUps.findOne).toHaveBeenCalledWith({
        where: { id: "fu-1", organization_id: "org-1" },
        lock: { mode: "pessimistic_write" },
      });
      expect(result.outcome).toBe("Called, wants a callback");
      expect(result.sla_status).toBe(CRM_FOLLOW_UP_SLA_STATUS.MET);
      expect((result.completed_at as Date).toISOString()).toBe(
        "2026-03-01T12:00:00.000Z",
      );
      expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(
        CRM_EVENT_TYPES.FOLLOW_UP_COMPLETED,
        "v1",
        "org-1",
        {
          followUpId: "fu-1",
          leadId: "lead-1",
          organizationId: "org-1",
          outcome: "Called, wants a callback",
          completedAt: "2026-03-01T12:00:00.000Z",
        },
        "fu-1",
        undefined,
        expect.anything(),
      );
    });

    it("rejects a whitespace-only outcome without completing the follow-up", async () => {
      const x = setup();
      x.followUps.findOne.mockResolvedValue(openFollowUp());

      await expect(
        x.service.complete("fu-1", { outcome: "   \n\t " }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(x.followUps.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("is met exactly AT the deadline and breached one millisecond later", async () => {
      const atDeadline = setup();
      jest.setSystemTime(new Date("2026-03-01T13:00:00.000Z"));
      atDeadline.followUps.findOne.mockResolvedValue(openFollowUp());
      atDeadline.followUps.save.mockImplementation(async (value: any) => value);

      const onTime = await atDeadline.service.complete("fu-1", {
        outcome: "Reached at the buzzer",
      });
      expect(onTime.sla_status).toBe(CRM_FOLLOW_UP_SLA_STATUS.MET);

      const justLate = setup();
      jest.setSystemTime(new Date("2026-03-01T13:00:00.001Z"));
      justLate.followUps.findOne.mockResolvedValue(openFollowUp());
      justLate.followUps.save.mockImplementation(async (value: any) => value);

      const missed = await justLate.service.complete("fu-1", {
        outcome: "Reached too late",
      });
      expect(missed.sla_status).toBe(CRM_FOLLOW_UP_SLA_STATUS.BREACHED);
    });

    it("falls back to follow_up_date when the follow-up carries no policy deadline", async () => {
      const x = setup();
      jest.setSystemTime(new Date("2026-03-01T09:00:00.001Z"));
      x.followUps.findOne.mockResolvedValue(openFollowUp({ due_at: null }));
      x.followUps.save.mockImplementation(async (value: any) => value);

      const result = await x.service.complete("fu-1", {
        outcome: "one millisecond late",
      });

      expect(result.sla_status).toBe(CRM_FOLLOW_UP_SLA_STATUS.BREACHED);
    });

    it("refuses a second completion instead of writing a second event", async () => {
      const x = setup();
      jest.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
      x.followUps.findOne.mockResolvedValue(
        openFollowUp({ completed_at: new Date("2026-03-01T11:00:00.000Z") }),
      );

      await expect(
        x.service.complete("fu-1", { outcome: "again" }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(x.followUps.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("cannot complete a follow-up belonging to another organization", async () => {
      const x = setup();
      jest.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
      x.followUps.findOne.mockResolvedValue(null);

      await expect(
        x.service.complete("other-org-fu", { outcome: "x" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(x.followUps.findOne).toHaveBeenCalledWith({
        where: { id: "other-org-fu", organization_id: "org-1" },
        lock: { mode: "pessimistic_write" },
      });
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });
  });

  describe("listDue", () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: "fu-1",
      organization_id: "org-1",
      lead_id: "lead-1",
      follow_up_date: new Date("2026-03-01T09:00:00.000Z"),
      due_at: new Date("2026-03-01T13:00:00.000Z"),
      completed_at: null,
      ...overrides,
    });

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("queries only the authorized org, only open follow-ups, soonest first", async () => {
      const x = setup();
      x.followUps.findAndCount.mockResolvedValue([[row()], 1]);

      const result = await x.service.listDue({
        withinHours: 0,
        page: 2,
        limit: 10,
      } as never);

      const query = x.followUps.findAndCount.mock.calls[0][0] as never as {
        where: Record<string, { type: string }>;
        order: Record<string, string>;
        take: number;
        skip: number;
      };
      expect(query.where.organization_id).toBe("org-1");
      expect(query.where.completed_at.type).toBe("isNull");
      // now (12:00Z) + 0 hours
      expect(
        (
          query.where.follow_up_date as never as { value: Date }
        ).value.toISOString(),
      ).toBe("2026-03-01T12:00:00.000Z");
      expect(query.order).toEqual({ follow_up_date: "ASC" });
      expect(query.take).toBe(10);
      expect(query.skip).toBe(10);
      expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
      expect(result.data[0].overdue).toBe(false);
    });

    it("widens the window by withinHours", async () => {
      const x = setup();
      x.followUps.findAndCount.mockResolvedValue([[], 0]);

      await x.service.listDue({ withinHours: 4, page: 1, limit: 20 } as never);

      const query = x.followUps.findAndCount.mock.calls[0][0] as never as {
        where: { follow_up_date: { value: Date } };
      };
      expect(query.where.follow_up_date.value.toISOString()).toBe(
        "2026-03-01T16:00:00.000Z",
      );
    });

    it("flags overdue false exactly AT the deadline and true one millisecond later", async () => {
      jest.setSystemTime(new Date("2026-03-01T13:00:00.000Z"));
      const atDeadline = setup();
      atDeadline.followUps.findAndCount.mockResolvedValue([[row()], 1]);

      const onTime = await atDeadline.service.listDue({
        withinHours: 0,
        page: 1,
        limit: 20,
      } as never);
      expect(onTime.data[0].overdue).toBe(false);

      jest.setSystemTime(new Date("2026-03-01T13:00:00.001Z"));
      const justLate = setup();
      justLate.followUps.findAndCount.mockResolvedValue([[row()], 1]);

      const missed = await justLate.service.listDue({
        withinHours: 0,
        page: 1,
        limit: 20,
      } as never);
      expect(missed.data[0].overdue).toBe(true);
    });

    it("derives overdue from follow_up_date when no policy deadline is present", async () => {
      jest.setSystemTime(new Date("2026-03-01T09:00:00.001Z"));
      const x = setup();
      x.followUps.findAndCount.mockResolvedValue([[row({ due_at: null })], 1]);

      const result = await x.service.listDue({
        withinHours: 0,
        page: 1,
        limit: 20,
      } as never);

      expect(result.data[0].overdue).toBe(true);
    });
  });

  describe("generateFollowUps", () => {
    const now = new Date("2026-03-01T09:00:00.000Z");
    const activePolicy = (overrides: Record<string, unknown> = {}) => ({
      id: "policy-1",
      organization_id: "org-1",
      name: "Standard",
      applies_to: null,
      first_response_hours: 24,
      follow_up_interval_hours: 48,
      escalation_after_hours: 12,
      max_follow_ups_per_period: null,
      cap_period_days: 30,
      is_active: true,
      ...overrides,
    });
    const lead = (overrides: Record<string, unknown> = {}) => ({
      id: "lead-1",
      organization_id: "org-1",
      status: "new",
      stage_id: null,
      ...overrides,
    });

    it("creates one follow-up at the policy cadence for an eligible lead", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([activePolicy()]);
      x.leads.find.mockResolvedValue([lead()]);
      x.followUps.save.mockImplementation(async (value: any) => ({
        id: "fu-1",
        ...value,
      }));

      const result = await x.service.generateFollowUps({ limit: 10, now });

      expect(result).toEqual({ scanned: 1, generated: 1, policies: 1 });
      expect(x.followUps.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: "org-1",
          lead_id: "lead-1",
          sla_policy_id: "policy-1",
          // now + follow_up_interval_hours (48h), then the same interval again as
          // the SLA grace window.
          follow_up_date: new Date("2026-03-03T09:00:00.000Z"),
          due_at: new Date("2026-03-05T09:00:00.000Z"),
        }),
      );
      expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(
        CRM_EVENT_TYPES.FOLLOW_UP_SCHEDULED,
        "v1",
        "org-1",
        expect.objectContaining({ leadId: "lead-1", slaPolicyId: "policy-1" }),
        "fu-1",
        undefined,
        expect.anything(),
      );
    });

    it("reads no tenant context — the scan is deliberately cross-organization", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([]);

      await x.service.generateFollowUps({ limit: 10, now });

      expect(x.tenant.getCurrentOrganizationId).not.toHaveBeenCalled();
    });

    it("writes every follow-up under its own policy organization", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([
        activePolicy(),
        activePolicy({ id: "policy-2", organization_id: "org-2" }),
      ]);
      x.leads.find
        .mockResolvedValueOnce([lead()])
        .mockResolvedValueOnce([
          lead({ id: "lead-2", organization_id: "org-2" }),
        ]);
      x.followUps.save.mockImplementation(async (value: any) => ({
        id: "fu",
        ...value,
      }));

      const result = await x.service.generateFollowUps({ limit: 10, now });

      expect(result.generated).toBe(2);
      expect(
        x.followUps.create.mock.calls.map(
          ([value]: [any]) =>
            (value as { organization_id: string }).organization_id,
        ),
      ).toEqual(["org-1", "org-2"]);
    });

    it("skips a lead that already has an open follow-up (worker idempotency)", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([activePolicy()]);
      x.leads.find.mockResolvedValue([lead()]);
      x.followUps.count.mockResolvedValue(1);

      const result = await x.service.generateFollowUps({ limit: 10, now });

      expect(result).toEqual({ scanned: 1, generated: 0, policies: 1 });
      expect(x.followUps.save).not.toHaveBeenCalled();
      expect(x.outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it("honours the follow-up-fatigue cap per lead per period", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([
        activePolicy({ max_follow_ups_per_period: 2 }),
      ]);
      x.leads.find.mockResolvedValue([lead()]);
      // No open follow-up, but the cap for the period is already used up.
      x.followUps.count.mockImplementation(async (options: any) =>
        "created_at" in
        (options as never as { where: Record<string, unknown> }).where
          ? 2
          : 0,
      );

      const result = await x.service.generateFollowUps({ limit: 10, now });

      expect(result.generated).toBe(0);
      expect(x.followUps.save).not.toHaveBeenCalled();

      const capQuery = x.followUps.count.mock.calls.find(
        ([options]: [any]) =>
          "created_at" in
          (options as never as { where: Record<string, unknown> }).where,
      )![0] as never as {
        where: {
          organization_id: string;
          lead_id: string;
          created_at: { value: Date };
        };
      };
      expect(capQuery.where.organization_id).toBe("org-1");
      expect(capQuery.where.lead_id).toBe("lead-1");
      // now - cap_period_days (30 days)
      expect(capQuery.where.created_at.value.toISOString()).toBe(
        "2026-01-30T09:00:00.000Z",
      );
    });

    it("applies the policy stage filter and scopes the lead scan to the policy organization", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([
        activePolicy({ applies_to: "contacted" }),
      ]);
      x.stages.find.mockResolvedValue([{ id: "stage-contacted" }]);
      x.leads.find.mockResolvedValue([
        lead({ id: "lead-wrong-stage", stage_id: "stage-new" }),
        lead({
          id: "lead-match",
          status: "contacted",
          stage_id: "stage-contacted",
        }),
      ]);
      x.followUps.save.mockImplementation(async (value: any) => ({
        id: "fu",
        ...value,
      }));

      const result = await x.service.generateFollowUps({ limit: 10, now });

      expect(result).toEqual({ scanned: 2, generated: 1, policies: 1 });
      expect(x.followUps.create).toHaveBeenCalledWith(
        expect.objectContaining({ lead_id: "lead-match" }),
      );
      expect(x.stages.find).toHaveBeenCalledWith({
        where: { organization_id: "org-1", key: "contacted" },
      });
      const leadQuery = x.leads.find.mock.calls[0][0] as never as {
        where: { organization_id: string; status: { type: string } };
      };
      expect(leadQuery.where.organization_id).toBe("org-1");
      expect(leadQuery.where.status.type).toBe("not");
    });

    it("stops at the batch limit", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([activePolicy()]);
      x.leads.find.mockResolvedValue([
        lead({ id: "lead-1" }),
        lead({ id: "lead-2" }),
        lead({ id: "lead-3" }),
      ]);
      x.followUps.save.mockImplementation(async (value: any) => ({
        id: "fu",
        ...value,
      }));

      const result = await x.service.generateFollowUps({ limit: 2, now });

      expect(result.generated).toBe(2);
      expect(x.followUps.save).toHaveBeenCalledTimes(2);
    });

    it("scans only active policies, and defaults the limit and clock when called bare", async () => {
      const x = setup();
      x.policies.find.mockResolvedValue([]);

      await expect(x.service.generateFollowUps()).resolves.toEqual({
        scanned: 0,
        generated: 0,
        policies: 0,
      });
      expect(x.policies.find).toHaveBeenCalledWith({
        where: { is_active: true },
      });
    });
  });
});
