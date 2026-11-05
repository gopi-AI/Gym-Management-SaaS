/**
 * Trainer decision on a member's prescribed-day submission.
 *
 * `approve` closes the day as finished (fully or partially completed — the
 * trainer's decision is authoritative). `request_remaining` keeps the day
 * pending so the member can complete the remaining exercises in another
 * session.
 */
export enum PlanDayReviewDecision {
  APPROVE = 'approve',
  REQUEST_REMAINING = 'request_remaining',
}

export const PLAN_DAY_REVIEW_DECISION_VALUES: readonly PlanDayReviewDecision[] =
  Object.values(PlanDayReviewDecision);
