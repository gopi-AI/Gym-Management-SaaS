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

/**
 * Workouts tab API (Phase 2, P2-05).
 *
 * Route layer only — wires the already-complete `WorkoutsService` read methods to
 * HTTP. The domain entities and read logic were implemented in Phase 2; this
 * controller adds no new queries or writes.
 *
 * Response:
 *   - `assignments`: workout plans assigned to the member (P2-05)
 *   - `exercises`: org-wide exercise library (P2-05)
 */
@Controller('v1/members/:memberId/workouts')
export class WorkoutsTabController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(
    { resource: 'workout', action: 'assignment-read' },
    { resource: 'workout', action: 'exercise-read' },
  )
  async getWorkouts(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ): Promise<{
    assignments: WorkoutPlanAssignment[];
    exercises: Exercise[];
  }> {
    return {
      assignments: await this.workoutsService.findAllAssignments(memberId),
      exercises: await this.workoutsService.findAllExercises(),
    };
  }
}