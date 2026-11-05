/**
 * Status of a prescribed workout day inside an assignment.
 *
 *   pending            not yet submitted by the member
 *   submitted          a member submission awaits trainer review
 *   remaining_required the trainer asked for the remaining exercises
 *   approved           the trainer approved the day as finished
 *
 * Only `approved` counts toward the primary plan-progress formula. A member's
 * submission never changes this status to `approved` by itself.
 */
export enum PlanDayStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  REMAINING_REQUIRED = 'remaining_required',
  APPROVED = 'approved',
}

export const PLAN_DAY_STATUS_VALUES: readonly PlanDayStatus[] =
  Object.values(PlanDayStatus);
