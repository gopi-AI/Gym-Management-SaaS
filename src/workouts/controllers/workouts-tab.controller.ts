import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { WorkoutsService } from '../services/workouts.service';
import { Exercise } from '../entities/exercise.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { WorkoutSession } from '../entities/workout-session.entity';

/**
 * Workouts tab API (Phase 2, P2-05).
 *
 * The combined Member 360 read: assigned plans, session history and the
 * org-wide exercise library.
 *
 * Response:
 *   - `assignments`: workout plans assigned to the member, each with its
 *     per-assignment progress. `progress.completed` / `progress.prescribed` are
 *     trainer-approved prescribed days / non-rest prescribed days — NOT
 *     exercise-row counts. `progress.exercise_completion` is the separate
 *     supporting metric.
 *   - `sessions`: the member's workout-session history, newest first. Soft-
 *     deleted sessions are excluded; finished and cancelled sessions remain.
 *   - `exercises`: org-wide exercise library.
 */
@Controller('v1/members/:memberId/workouts')
export class WorkoutsTabController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(
    { resource: 'workout', action: 'assignment-read' },
    { resource: 'workout', action: 'exercise-read' },
    { resource: 'workout', action: 'session-read' },
  )
  async getWorkouts(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ): Promise<{
    assignments: Array<
      WorkoutPlanAssignment & {
        progress: { completed: number; prescribed: number; percentage: number };
      }
    >;
    sessions: WorkoutSession[];
    exercises: Exercise[];
  }> {
    const [assignments, sessions, exercises] = await Promise.all([
      this.workoutsService.findAllAssignments(memberId),
      this.workoutsService.findAllSessions(memberId),
      this.workoutsService.findAllExercises(),
    ]);

    const assignmentsWithProgress = await Promise.all(
      assignments.map(async (assignment) => ({
        ...assignment,
        progress: await this.workoutsService.getAssignmentProgress(assignment.id),
      })),
    );

    return { assignments: assignmentsWithProgress, sessions, exercises };
  }
}