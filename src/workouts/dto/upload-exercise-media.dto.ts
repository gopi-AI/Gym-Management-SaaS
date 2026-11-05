import { IsEnum } from 'class-validator';
import {
  EXERCISE_MEDIA_TYPES,
  ExerciseMediaType,
} from '../workouts.constants';

/** Selects which optional exercise media slot an upload targets. */
export class UploadExerciseMediaDto {
  @IsEnum(EXERCISE_MEDIA_TYPES)
  media_type!: ExerciseMediaType;
}
