import { EventEnvelope } from './event-envelope';

/**
 * Workout domain events.
 *
 * `WorkoutPlanAssigned.v1` is produced by the Workouts module when a workout
 * plan is assigned to a member (see `WorkoutsService.assignPlan()`).
 *
 * `WorkoutSessionLogged.v1` is the Phase 2 event contract for session-logging.
 * It has NO producer in the committed codebase (the Workouts module emits only
 * `WorkoutPlanAssigned.v1`). The event is defined here so that consumer modules
 * (e.g. Loyalty) can build against the contract. The Workouts session-logging
 * endpoint and event producer are scoped as a separate follow-up task.
 * See `docs/phase2-scoping-plan.md` §12 Q17 and the Loyalty-build notes.
 */

// ---------------------------------------------------------------------------
// WorkoutPlanAssigned
// ---------------------------------------------------------------------------

export interface WorkoutPlanAssignedPayload {
  assignmentId: string;
  memberId: string;
  templateId: string;
  assignedBy: string;
  assignedAt: string;
  startDate: string;
  endDate: string | null;
}

export type WorkoutPlanAssignedEvent = EventEnvelope<WorkoutPlanAssignedPayload>;

// ---------------------------------------------------------------------------
// WorkoutSessionLogged
// ---------------------------------------------------------------------------

/**
 * `WorkoutSessionLogged.v1`
 *
 * Emitted when a member logs a workout session (self-directed or PT-supervised).
 * No producer exists in Phase 2 — the Workouts session-logging feature is a
 * separate follow-up task. Consumer modules that depend on this event (Loyalty)
 * build their handlers against this contract but the handler is inert until the
 * event is actually produced.
 */
export interface WorkoutSessionLoggedPayload {
  sessionId: string;
  memberId: string;
  organizationId: string;
  /** Nullable — a session can be logged without a template. */
  templateId: string | null;
  /** Nullable — a session can be logged without being linked to an assignment. */
  assignmentId: string | null;
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
// Union type and constants
// ---------------------------------------------------------------------------

export type WorkoutEvent = WorkoutPlanAssignedEvent | WorkoutSessionLoggedEvent;

export const WORKOUT_EVENT_TYPES = {
  WORKOUT_PLAN_ASSIGNED: 'WorkoutPlanAssigned',
  WORKOUT_SESSION_LOGGED: 'WorkoutSessionLogged',
} as const;

export const WORKOUT_EVENT_VERSIONS = {
  V1: 'v1',
} as const;

export const WORKOUT_EVENT_VERSION = 'v1';