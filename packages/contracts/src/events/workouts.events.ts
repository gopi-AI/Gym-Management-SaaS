import { EventEnvelope } from './event-envelope';

/**
 * Workout domain events.
 *
 * All five events are produced by the Workouts module through the
 * transactional outbox, in the same transaction as the domain write:
 *
 *   - `WorkoutPlanAssigned.v1`          — assignment created (legacy flat
 *                                          template or weekly plan template);
 *   - `WorkoutSessionLogged.v1`         — member starts/logs a session;
 *   - `WorkoutPlanDaySubmitted.v1`      — member submits a prescribed day;
 *   - `WorkoutPlanDayReviewed.v1`       — trainer approves or asks for remaining
 *                                          exercises;
 *   - `WorkoutProgressReviewRecorded.v1`— 30–45-day trainer review recorded.
 *
 * Event names are unversioned PascalCase; the version is carried separately.
 */

// ---------------------------------------------------------------------------
// WorkoutPlanAssigned
// ---------------------------------------------------------------------------

export interface WorkoutPlanAssignedPayload {
  assignmentId: string;
  memberId: string;
  /** Legacy flat template source (nullable). */
  templateId: string | null;
  /** Reusable weekly plan template source (nullable). */
  planTemplateId: string | null;
  assignedBy: string;
  assignedAt: string;
  startDate: string;
  endDate: string | null;
  /** `simple` (regular member) or `detailed` (PT member). */
  loggingMode: string;
}

export type WorkoutPlanAssignedEvent = EventEnvelope<WorkoutPlanAssignedPayload>;

// ---------------------------------------------------------------------------
// WorkoutSessionLogged
// ---------------------------------------------------------------------------

/**
 * `WorkoutSessionLogged.v1`
 *
 * Emitted when a member starts a session. The session is `in_progress` at this
 * point; `completedAt` is null until the member finishes it. Consumers that
 * accrue on a finished workout should use the plan-day review event instead
 * (a finished session does not approve a plan day).
 */
export interface WorkoutSessionLoggedPayload {
  sessionId: string;
  memberId: string;
  organizationId: string;
  /** Nullable — a session can be logged without a template. */
  templateId: string | null;
  /** Nullable — a session can be logged without being linked to an assignment. */
  assignmentId: string | null;
  /** Nullable — standalone sessions are not linked to a prescribed day. */
  prescribedDayId: string | null;
  /** ISO-8601 date (YYYY-MM-DD) of the session. */
  sessionDate: string;
  /** ISO-8601 timestamp when the session started. */
  startedAt: string | null;
  /** ISO-8601 timestamp when the session was completed. */
  completedAt: string | null;
  /** Duration in minutes. */
  durationMinutes: number | null;
}

export type WorkoutSessionLoggedEvent = EventEnvelope<WorkoutSessionLoggedPayload>;

// ---------------------------------------------------------------------------
// WorkoutPlanDaySubmitted
// ---------------------------------------------------------------------------

export interface WorkoutPlanDaySubmittedPayload {
  prescribedDayId: string;
  assignmentId: string;
  memberId: string;
  submissionId: string;
  submittedAt: string;
  /** Finished sessions that contributed to this submission. */
  sessionIds: string[];
}

export type WorkoutPlanDaySubmittedEvent =
  EventEnvelope<WorkoutPlanDaySubmittedPayload>;

// ---------------------------------------------------------------------------
// WorkoutPlanDayReviewed
// ---------------------------------------------------------------------------

export interface WorkoutPlanDayReviewedPayload {
  reviewId: string;
  prescribedDayId: string;
  assignmentId: string;
  memberId: string;
  /** `approve` or `request_remaining`. */
  decision: string;
  submissionId: string | null;
  reviewedBy: string;
  decidedAt: string;
  /** Resulting prescribed-day status (`approved` / `remaining_required`). */
  status: string;
}

export type WorkoutPlanDayReviewedEvent =
  EventEnvelope<WorkoutPlanDayReviewedPayload>;

// ---------------------------------------------------------------------------
// WorkoutProgressReviewRecorded
// ---------------------------------------------------------------------------

export interface WorkoutProgressReviewRecordedPayload {
  reviewId: string;
  memberId: string;
  assignmentId: string;
  reviewDate: string;
  periodStart: string;
  periodEnd: string;
  approvedDays: number;
  prescribedDays: number;
  progressPercentage: number;
  /** `continue`, `modify`, `extend` or `new_plan`. */
  decision: string;
  reviewedBy: string;
  resultingAssignmentId: string | null;
}

export type WorkoutProgressReviewRecordedEvent =
  EventEnvelope<WorkoutProgressReviewRecordedPayload>;

// ---------------------------------------------------------------------------
// Union type and constants
// ---------------------------------------------------------------------------

export type WorkoutEvent =
  | WorkoutPlanAssignedEvent
  | WorkoutSessionLoggedEvent
  | WorkoutPlanDaySubmittedEvent
  | WorkoutPlanDayReviewedEvent
  | WorkoutProgressReviewRecordedEvent;

export const WORKOUT_EVENT_TYPES = {
  WORKOUT_PLAN_ASSIGNED: 'WorkoutPlanAssigned',
  WORKOUT_SESSION_LOGGED: 'WorkoutSessionLogged',
  WORKOUT_PLAN_DAY_SUBMITTED: 'WorkoutPlanDaySubmitted',
  WORKOUT_PLAN_DAY_REVIEWED: 'WorkoutPlanDayReviewed',
  WORKOUT_PROGRESS_REVIEW_RECORDED: 'WorkoutProgressReviewRecorded',
} as const;

export const WORKOUT_EVENT_VERSIONS = {
  V1: 'v1',
} as const;

export const WORKOUT_EVENT_VERSION = 'v1';
