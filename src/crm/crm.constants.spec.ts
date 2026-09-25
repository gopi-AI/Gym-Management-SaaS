import {
  CRM_CLOSED_LEAD_STATUSES,
  CRM_EVENT_TYPES,
  CRM_FOLLOW_UP_SLA_STATUS,
  CRM_PERMISSIONS,
  CRM_SLA_BREACH_TYPES,
  followUpDeadline,
  HOUR_MS,
  isBreachEscalationDue,
  isFirstResponseOverdue,
  isFollowUpOverdue,
} from "./crm.constants";

/**
 * Boundary tests for the P3-07 timing rules.
 *
 * These four helpers are the only place a deadline is compared to "now" — the
 * monitor, the due list and the completion path all route through them — so an
 * off-by-one here would silently mis-classify every follow-up in the system. Each
 * test therefore pins BOTH sides of the boundary instant, not just the happy path.
 */
describe("crm.constants — P3-07 time boundaries", () => {
  const scheduled = new Date("2026-03-01T09:00:00.000Z");
  const deadline = new Date("2026-03-01T13:00:00.000Z");

  describe("followUpDeadline", () => {
    it("adds the policy interval as a grace window after the scheduled date", () => {
      expect(followUpDeadline(scheduled, 4).toISOString()).toBe(
        deadline.toISOString(),
      );
    });

    it("is the scheduled date itself when no policy is attached", () => {
      expect(followUpDeadline(scheduled, null).toISOString()).toBe(
        scheduled.toISOString(),
      );
      expect(followUpDeadline(scheduled, undefined).toISOString()).toBe(
        scheduled.toISOString(),
      );
    });

    it('treats a zero-hour interval as an immediate deadline, not as "no policy"', () => {
      expect(followUpDeadline(scheduled, 0).toISOString()).toBe(
        scheduled.toISOString(),
      );
    });

    it("does not mutate the scheduled date it was given", () => {
      const original = scheduled.toISOString();
      followUpDeadline(scheduled, 48);
      expect(scheduled.toISOString()).toBe(original);
    });
  });

  describe("isFollowUpOverdue", () => {
    it("is false exactly AT the deadline and true one millisecond later", () => {
      expect(
        isFollowUpOverdue(
          { follow_up_date: scheduled, due_at: deadline },
          deadline,
        ),
      ).toBe(false);
      expect(
        isFollowUpOverdue(
          { follow_up_date: scheduled, due_at: deadline },
          new Date(deadline.getTime() + 1),
        ),
      ).toBe(true);
    });

    it("is still on time one millisecond BEFORE the deadline", () => {
      expect(
        isFollowUpOverdue(
          { follow_up_date: scheduled, due_at: deadline },
          new Date(deadline.getTime() - 1),
        ),
      ).toBe(false);
    });

    it("falls back to follow_up_date when due_at is absent or null", () => {
      expect(
        isFollowUpOverdue({ follow_up_date: deadline, due_at: null }, deadline),
      ).toBe(false);
      expect(
        isFollowUpOverdue(
          { follow_up_date: deadline, due_at: null },
          new Date(deadline.getTime() + 1),
        ),
      ).toBe(true);
      // Field omitted entirely — an older/partial row.
      expect(
        isFollowUpOverdue(
          { follow_up_date: deadline },
          new Date(deadline.getTime() + 1),
        ),
      ).toBe(true);
    });

    it("treats a completed follow-up as never overdue, however late it completed", () => {
      const completedAt = new Date(deadline.getTime() + 30 * HOUR_MS);
      expect(
        isFollowUpOverdue(
          {
            follow_up_date: scheduled,
            due_at: deadline,
            completed_at: completedAt,
          },
          new Date(deadline.getTime() + 100 * HOUR_MS),
        ),
      ).toBe(false);
    });

    it("is not overdue while the deadline is still in the future", () => {
      expect(
        isFollowUpOverdue(
          { follow_up_date: scheduled, due_at: deadline },
          new Date(scheduled.getTime() - 24 * HOUR_MS),
        ),
      ).toBe(false);
    });
  });

  describe("isBreachEscalationDue", () => {
    const breachedAt = new Date("2026-03-01T09:00:00.000Z");

    it("is false exactly AT breached_at + escalation_after_hours and true one millisecond later", () => {
      const escalationInstant = new Date("2026-03-01T11:00:00.000Z");
      expect(
        isBreachEscalationDue(
          { breached_at: breachedAt },
          2,
          escalationInstant,
        ),
      ).toBe(false);
      expect(
        isBreachEscalationDue(
          { breached_at: breachedAt },
          2,
          new Date(escalationInstant.getTime() + 1),
        ),
      ).toBe(true);
    });

    it("never re-escalates a breach that already carries escalated_at", () => {
      expect(
        isBreachEscalationDue(
          {
            breached_at: breachedAt,
            escalated_at: new Date("2026-03-01T10:00:00.000Z"),
          },
          2,
          new Date("2026-03-02T00:00:00.000Z"),
        ),
      ).toBe(false);
    });

    it("with escalation_after_hours 0 escalates one millisecond after the breach, not at it", () => {
      expect(
        isBreachEscalationDue({ breached_at: breachedAt }, 0, breachedAt),
      ).toBe(false);
      expect(
        isBreachEscalationDue(
          { breached_at: breachedAt },
          0,
          new Date(breachedAt.getTime() + 1),
        ),
      ).toBe(true);
    });
  });

  describe("isFirstResponseOverdue", () => {
    const createdAt = new Date("2026-03-01T09:00:00.000Z");

    it("is false exactly AT created_at + first_response_hours and true one millisecond later", () => {
      const firstResponseAt = new Date(createdAt.getTime() + 24 * HOUR_MS);
      expect(isFirstResponseOverdue(createdAt, 24, firstResponseAt)).toBe(
        false,
      );
      expect(
        isFirstResponseOverdue(
          createdAt,
          24,
          new Date(firstResponseAt.getTime() + 1),
        ),
      ).toBe(true);
    });

    it("is not overdue before the window closes", () => {
      expect(
        isFirstResponseOverdue(
          createdAt,
          24,
          new Date(createdAt.getTime() + 23 * HOUR_MS),
        ),
      ).toBe(false);
    });
  });

  describe("value sets", () => {
    it("keeps the closed-lead set to the two terminal funnel values", () => {
      expect(CRM_CLOSED_LEAD_STATUSES).toEqual(["converted", "lost"]);
    });

    it("declares the four P3-07 event names and nine CRM events in total", () => {
      expect(CRM_EVENT_TYPES.FOLLOW_UP_SCHEDULED).toBe("FollowUpScheduled");
      expect(CRM_EVENT_TYPES.FOLLOW_UP_COMPLETED).toBe("FollowUpCompleted");
      expect(CRM_EVENT_TYPES.SLA_BREACHED).toBe("SlaBreached");
      expect(CRM_EVENT_TYPES.SLA_ESCALATED).toBe("SlaEscalated");
      expect(Object.keys(CRM_EVENT_TYPES)).toHaveLength(9);
    });

    it("pins the follow-up SLA statuses and breach types", () => {
      expect(Object.values(CRM_FOLLOW_UP_SLA_STATUS)).toEqual([
        "pending",
        "met",
        "breached",
      ]);
      expect(Object.values(CRM_SLA_BREACH_TYPES)).toEqual([
        "first_response",
        "follow_up_overdue",
      ]);
    });

    it("leaves CRM_PERMISSIONS at its four P3-06 entries", () => {
      // Regression guard for the retroactive-migration hazard documented on
      // `CRM_PERMISSIONS`: it is read by the ALREADY APPLIED
      // `ProvisionCrmPermissions1788965263267`, so adding permissions here would
      // silently change what that migration provisions on a fresh database.
      expect(CRM_PERMISSIONS.map(([name]) => name)).toEqual([
        "crm:read",
        "crm:create",
        "crm:update",
        "crm:convert",
      ]);
    });
  });
});
