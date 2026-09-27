export const CRM_LEAD_STATUS = {
  NEW: "new",
  CONTACTED: "contacted",
  QUALIFIED: "qualified",
  CONVERTED: "converted",
  LOST: "lost",
} as const;
export type CrmLeadStatus =
  (typeof CRM_LEAD_STATUS)[keyof typeof CRM_LEAD_STATUS];

export const CRM_EVENT_TYPES = {
  LEAD_CREATED: "LeadCreated",
  LEAD_CONTACTED: "LeadContacted",
  LEAD_QUALIFIED: "LeadQualified",
  MEMBER_CONVERTED: "MemberConverted",
  LEAD_LOST: "LeadLost",
  FOLLOW_UP_SCHEDULED: "FollowUpScheduled",
  FOLLOW_UP_COMPLETED: "FollowUpCompleted",
  SLA_BREACHED: "SlaBreached",
  SLA_ESCALATED: "SlaEscalated",
} as const;
export const CRM_EVENT_VERSION = "v1";

/**
 * P3-06 permissions. Consumed by `ProvisionCrmPermissions1788965263267`, which has
 * already been applied to every existing database, so this array MUST NOT be
 * extended: appending an entry would retroactively change what that applied
 * migration provisions. Later permissions belong in the migration that creates
 * them, matching `ProvisionInventoryPermissions` / `ProvisionFinanceAdminPermission`.
 */
export const CRM_PERMISSIONS = [
  ["crm:read", "Read CRM leads and pipeline", "read"],
  ["crm:create", "Create CRM leads", "create"],
  ["crm:update", "Update CRM leads and activities", "update"],
  ["crm:convert", "Convert CRM leads to members", "convert"],
] as const;

/**
 * P3-07 — SLA lifecycle of a follow-up (`CRM_FOLLOW_UPS.sla_status`).
 *
 * `pending`  — scheduled, not yet completed.
 * `met`      — completed at or before its SLA deadline (`due_at`).
 * `breached` — completed after the deadline, or still open past it (the SLA
 *              monitor sets this when it records the breach).
 */
export const CRM_FOLLOW_UP_SLA_STATUS = {
  PENDING: "pending",
  MET: "met",
  BREACHED: "breached",
} as const;
export type CrmFollowUpSlaStatus =
  (typeof CRM_FOLLOW_UP_SLA_STATUS)[keyof typeof CRM_FOLLOW_UP_SLA_STATUS];

/**
 * P3-07 — breach kinds (`CRM_SLA_BREACHES.breach_type`).
 *
 * `first_response`     — a lead sat untouched past the policy's
 *                        `first_response_hours` with no logged activity. This is
 *                        the reason `CRM_SLA_BREACHES.follow_up_id` is nullable:
 *                        a first-response breach is a property of the lead, not
 *                        of any one follow-up.
 * `follow_up_overdue`  — a follow-up passed its `due_at` without completion.
 */
export const CRM_SLA_BREACH_TYPES = {
  FIRST_RESPONSE: "first_response",
  FOLLOW_UP_OVERDUE: "follow_up_overdue",
} as const;
export type CrmSlaBreachType =
  (typeof CRM_SLA_BREACH_TYPES)[keyof typeof CRM_SLA_BREACH_TYPES];

/** Lead states that no longer need nurturing, so the scheduler skips them. */
export const CRM_CLOSED_LEAD_STATUSES: string[] = [
  CRM_LEAD_STATUS.CONVERTED,
  CRM_LEAD_STATUS.LOST,
];

export const HOUR_MS = 60 * 60 * 1000;

/**
 * The instant a follow-up's SLA deadline falls on.
 *
 * `follow_up_date` is the ERD's scheduled date — "when should staff act on this
 * lead?" — and `due_at` is the deadline the SLA is measured against. §9 lists
 * both columns without saying how they differ, so the split chosen here is:
 *
 *   follow_up_date : when the follow-up becomes actionable (drives `/due`)
 *   due_at         : when it becomes an SLA breach if still incomplete
 *                    (drives the SLA monitor)
 *
 * With a policy attached, the policy's `follow_up_interval_hours` is the grace
 * window *after* the scheduled date before the missed follow-up counts as a
 * breach — that is the "not completed within X time of being due" rule. Without a
 * policy there is no SLA to miss, so the two are equal.
 */
export function followUpDeadline(
  followUpDate: Date,
  intervalHours: number | null | undefined,
): Date {
  if (intervalHours === null || intervalHours === undefined)
    return new Date(followUpDate);
  return new Date(followUpDate.getTime() + intervalHours * HOUR_MS);
}

/** Fields the overdue test needs; satisfied by the `FollowUp` entity. */
export interface FollowUpTiming {
  follow_up_date: Date;
  due_at?: Date | null;
  completed_at?: Date | null;
}

/**
 * Has this follow-up missed its SLA deadline?
 *
 * Strictly `now > deadline`, so a follow-up whose deadline is exactly `now` is
 * still on time: at the deadline instant the follow-up is due, and calling it
 * breached at that same instant would be wrong. One millisecond later it is late.
 *
 * A completed follow-up is never overdue, even when it completed late — lateness
 * is expressed by `sla_status`, not by keeping the item on the breach queue.
 */
export function isFollowUpOverdue(
  followUp: FollowUpTiming,
  now: Date,
): boolean {
  if (followUp.completed_at) return false;
  const deadline = followUp.due_at ?? followUp.follow_up_date;
  return now.getTime() > new Date(deadline).getTime();
}

/**
 * Is an already-recorded breach due for escalation?
 *
 * Escalation happens once, `escalation_after_hours` after the breach was
 * recorded. Same strictness as {@link isFollowUpOverdue}: at the boundary instant
 * escalation is not yet due. An already-escalated breach is never due again,
 * which is what keeps the monitor idempotent.
 */
export function isBreachEscalationDue(
  breach: { breached_at: Date; escalated_at?: Date | null },
  escalationAfterHours: number,
  now: Date,
): boolean {
  if (breach.escalated_at) return false;
  const escalateAt =
    new Date(breach.breached_at).getTime() + escalationAfterHours * HOUR_MS;
  return now.getTime() > escalateAt;
}

/** Has a lead gone past the policy's first-response window with no activity? */
export function isFirstResponseOverdue(
  leadCreatedAt: Date,
  firstResponseHours: number,
  now: Date,
): boolean {
  const deadline =
    new Date(leadCreatedAt).getTime() + firstResponseHours * HOUR_MS;
  return now.getTime() > deadline;
}
