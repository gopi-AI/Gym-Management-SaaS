export enum ExerciseCategory {
  STRENGTH = 'strength',
  CARDIO = 'cardio',
  FLEXIBILITY = 'flexibility',
  BALANCE = 'balance',
  FUNCTIONAL = 'functional',
  SPORT_SPECIFIC = 'sport_specific',
}

export const EXERCISE_CATEGORY_VALUES: readonly ExerciseCategory[] =
  Object.values(ExerciseCategory);