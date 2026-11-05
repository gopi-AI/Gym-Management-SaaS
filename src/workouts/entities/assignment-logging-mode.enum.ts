/**
 * How a member records completion for an assigned plan.
 *
 *   simple    regular member: a completed / not-completed checkbox per exercise
 *   detailed  PT member: actual sets, repetitions and weight per exercise
 *
 * The mode is chosen by the trainer when assigning the plan. Workouts must not
 * infer it from the PT module — the dependency is one-directional
 * (`PT → Workouts`), so reading `PT_*` tables here would create a cycle.
 */
export enum AssignmentLoggingMode {
  SIMPLE = 'simple',
  DETAILED = 'detailed',
}

export const ASSIGNMENT_LOGGING_MODE_VALUES: readonly AssignmentLoggingMode[] =
  Object.values(AssignmentLoggingMode);
