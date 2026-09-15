import { IsUUID } from 'class-validator';

/**
 * Input for manually linking a `PTSession` to an already-logged
 * `WorkoutSession` (§12 Q27).
 *
 * This is the ONLY way `PTSession.workout_session_id` is ever set — the PT module
 * never auto-creates a `WorkoutSession` and never auto-populates the link.
 */
export class LinkWorkoutSessionDto {
  @IsUUID()
  workout_session_id!: string;
}