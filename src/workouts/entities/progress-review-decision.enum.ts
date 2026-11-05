/**
 * Trainer's plan decision at a 30–45-day progress review.
 *
 * The decision is recorded for history. It does not mutate the active
 * assignment: a new or next-level plan still requires an explicit assignment.
 */
export enum ProgressReviewDecision {
  CONTINUE = 'continue',
  MODIFY = 'modify',
  EXTEND = 'extend',
  NEW_PLAN = 'new_plan',
}

export const PROGRESS_REVIEW_DECISION_VALUES: readonly ProgressReviewDecision[] =
  Object.values(ProgressReviewDecision);
