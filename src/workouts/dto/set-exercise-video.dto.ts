import { IsString, Matches, MaxLength } from 'class-validator';
import { YOUTUBE_URL_PATTERN } from '../workouts.constants';

/**
 * Optional YouTube video for an exercise.
 *
 * Only the two canonical YouTube video URL shapes are accepted; a trainer
 * cannot store an arbitrary URL. The strict pattern is the allow-list.
 */
export class SetExerciseVideoDto {
  @IsString()
  @MaxLength(2048)
  @Matches(YOUTUBE_URL_PATTERN, {
    message: 'video_url must be a https://youtube.com/watch?v=<id> or https://youtu.be/<id> URL',
  })
  video_url!: string;
}
