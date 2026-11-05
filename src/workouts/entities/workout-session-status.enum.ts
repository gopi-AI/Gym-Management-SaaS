/**
 * Member-facing workout-session lifecycle (P2-05).
 *
 *   in_progress  member may continue, finish or cancel
 *   finished     view-only; locked against further member edits
 *   cancelled    retained in history; view-only
 *
 * This is deliberately separate from `PlanDayStatus`: a finished session does
 * NOT imply an approved prescribed plan day.
 */
export enum WorkoutSessionStatus {
  IN_PROGRESS = 'in_progress',
  FINISHED = 'finished',
  CANCELLED = 'cancelled',
}

export const WORKOUT_SESSION_STATUS_VALUES: readonly WorkoutSessionStatus[] =
  Object.values(WorkoutSessionStatus);
