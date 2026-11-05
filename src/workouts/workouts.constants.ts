/**
 * Workouts domain constants.
 *
 * Mirrors `packages/contracts/src/events/workouts.events.ts`, which mirrors
 * `docs/event-contracts.md` (§Workouts Events). The backend deliberately does
 * not import the contracts package at build time (rootDir is ./src), so the
 * names are mirrored here and MUST stay in lockstep.
 *
 * Event names are unversioned PascalCase with the version carried separately,
 * matching the attendance/loyalty convention.
 */

/** Current event version for workout events. */
export const WORKOUT_EVENT_VERSION = 'v1';

export const WORKOUT_EVENT_TYPES = {
  WORKOUT_PLAN_ASSIGNED: 'WorkoutPlanAssigned',
  WORKOUT_SESSION_LOGGED: 'WorkoutSessionLogged',
  WORKOUT_PLAN_DAY_SUBMITTED: 'WorkoutPlanDaySubmitted',
  WORKOUT_PLAN_DAY_REVIEWED: 'WorkoutPlanDayReviewed',
  WORKOUT_PROGRESS_REVIEW_RECORDED: 'WorkoutProgressReviewRecorded',
} as const;

/**
 * Exercise media upload limits.
 *
 * These are implementation defaults (not owner-ratified values): 5 MiB per
 * file, raster images only. They are centralised here so raising them is a
 * one-line change and so the controller, service and tests cannot drift.
 */
export const EXERCISE_MEDIA_MAX_BYTES = 5 * 1024 * 1024;

export const EXERCISE_MEDIA_TYPES = {
  IMAGE: 'image',
  GIF: 'gif',
} as const;

export type ExerciseMediaType =
  (typeof EXERCISE_MEDIA_TYPES)[keyof typeof EXERCISE_MEDIA_TYPES];

export const EXERCISE_IMAGE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export const EXERCISE_GIF_MIME_TYPES: readonly string[] = ['image/gif'];

/**
 * Strict YouTube URL allow-list. Only an 11-character video id on the two
 * canonical hosts is accepted, so an arbitrary URL can never be embedded.
 */
export const YOUTUBE_URL_PATTERN =
  /^https:\/\/(www\.)?(youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}|youtu\.be\/[A-Za-z0-9_-]{11})$/;
