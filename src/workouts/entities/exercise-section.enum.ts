/**
 * Trainer-authored section of a workout day.
 *
 * The trainer controls the complete composition; this enum only labels rows so
 * warm-up, strength, cardio/treadmill, stretching and recovery can be grouped
 * in the UI. It is not a prescribed order — `sort_order` is.
 */
export enum ExerciseSection {
  WARMUP = 'warmup',
  STRENGTH = 'strength',
  CARDIO = 'cardio',
  STRETCH = 'stretch',
  RECOVERY = 'recovery',
}

export const EXERCISE_SECTION_VALUES: readonly ExerciseSection[] =
  Object.values(ExerciseSection);
