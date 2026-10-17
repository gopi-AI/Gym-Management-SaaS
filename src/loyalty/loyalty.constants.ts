/**
 * Loyalty domain constants.
 *
 * The inbound event-name constants mirror the contracts package
 * (`AttendanceEventRecorded` in attendance.events.ts, `WorkoutSessionLogged` in
 * workouts.events.ts); the loyalty module's own outbound events are declared
 * below. Entity schema references are in docs/phase2-scoping-plan.md (§5,
 * §12 Q16–Q22).
 *
 * The backend deliberately does not import the contracts package at build time
 * (rootDir is ./src), so mirrored names MUST stay in lockstep by hand.
 */

// ---------------------------------------------------------------------------
// Trigger events (matches LoyaltyRule.trigger_event column)
// ---------------------------------------------------------------------------

export const LOYALTY_TRIGGER_EVENTS = {
  CHECK_IN: 'check_in',
  WORKOUT_LOGGED: 'workout_logged',
} as const;

export type LoyaltyTriggerEvent = (typeof LOYALTY_TRIGGER_EVENTS)[keyof typeof LOYALTY_TRIGGER_EVENTS];

export const LOYALTY_TRIGGER_EVENT_VALUES: string[] = Object.values(LOYALTY_TRIGGER_EVENTS);

// ---------------------------------------------------------------------------
// Transaction types (matches LoyaltyTransaction.transaction_type column)
// ---------------------------------------------------------------------------

export const LOYALTY_TRANSACTION_TYPES = {
  EARN: 'earn',
  ADJUST: 'adjust',
  EXPIRE: 'expire',
  REDEEM: 'redeem',
} as const;

export type LoyaltyTransactionType =
  (typeof LOYALTY_TRANSACTION_TYPES)[keyof typeof LOYALTY_TRANSACTION_TYPES];

export const LOYALTY_TRANSACTION_TYPE_VALUES: string[] =
  Object.values(LOYALTY_TRANSACTION_TYPES);

// ---------------------------------------------------------------------------
// Reward types (matches LoyaltyReward.reward_type column, unused in Phase 2)
// ---------------------------------------------------------------------------

export const LOYALTY_REWARD_TYPES = {
  DISCOUNT: 'discount',
  ITEM: 'item',
  FREE_SESSION: 'free_session',
} as const;

export const LOYALTY_REWARD_TYPE_VALUES: string[] = Object.values(LOYALTY_REWARD_TYPES);

// ---------------------------------------------------------------------------
// Outbound event types produced by the loyalty module
// ---------------------------------------------------------------------------

export const LOYALTY_EVENT_TYPES = {
  LOYALTY_POINTS_AWARDED: 'LoyaltyPointsAwarded',
  LOYALTY_POINTS_EXPIRED: 'LoyaltyPointsExpired',
  LOYALTY_POINTS_ADJUSTED: 'LoyaltyPointsAdjusted',
} as const;

export const LOYALTY_EVENT_VERSION = 'v1';

// ---------------------------------------------------------------------------
// Inbound event types consumed by the loyalty module
// ---------------------------------------------------------------------------

/**
 * The attendance module's event type for a recorded attendance event.
 * The loyalty module filters on payload.eventType === 'CHECK_IN'.
 */
export const ATTENDANCE_EVENT_TYPE = 'AttendanceEventRecorded';

/**
 * The workouts module's event type for a logged workout session.
 * NO PRODUCER EXISTS IN PHASE 2 — defined for forward-compatibility.
 */
export const WORKOUT_SESSION_LOGGED_EVENT_TYPE = 'WorkoutSessionLogged';

// ---------------------------------------------------------------------------
// Reference type values for LoyaltyTransaction.reference_type
// ---------------------------------------------------------------------------

export const LOYALTY_REFERENCE_TYPES = {
  CHECK_IN: 'check_in',
  WORKOUT_SESSION: 'workout_session',
  EXPIRY_SWEEP: 'expiry_sweep',
  ADMIN_ADJUST: 'admin_adjust',
} as const;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default points expiry period when the organization has no value set. */
export const DEFAULT_POINTS_EXPIRY_DAYS = 365;

/** Default max earnings per trigger per day from a LoyaltyRule. */
export const DEFAULT_MAX_PER_DAY = 1;