import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { PtEnrollmentsService } from '../services/pt-enrollments.service';
import { PtSessionsService } from '../services/pt-sessions.service';
import { WorkoutsService } from '../../workouts/services/workouts.service';
import { PTEnrollment } from '../entities/pt-enrollment.entity';
import { PTSession } from '../entities/pt-session.entity';
import { WorkoutPlanAssignment } from '../../workouts/entities/workout-plan-assignment.entity';
import { ListPtEnrollmentsDto } from '../dto/list-pt-enrollments.dto';
import { ListPtSessionsDto } from '../dto/list-pt-sessions.dto';

/**
 * PT tab API (Phase 2, P2-04).
 *
 * Route layer only — wires the already-complete PtEnrollmentsService,
 * PtSessionsService and WorkoutsService read methods to HTTP. No new
 * queries or writes beyond composing per-assignment progress for the
 * member's own assignments (see `workoutProgress` below).
 *
 * `member_id` is passed to the two PT services as a manually-built filter
 * DTO (not bound via @Query(), since the filter comes from the route
 * param, not client-supplied query params) — both DTOs' only relevant
 * field is optional, so this is structurally safe without running it
 * through ValidationPipe.
 *
 * Response:
 *   - `enrollments`: all PT enrollments for the member (P2-04)
 *   - `sessions`: all PT sessions for the member, past and future (P2-04)
 *   - `workoutProgress`: the member's workout assignments paired with
 *     their per-assignment progress, reusing WorkoutsService as-is
 *     (P2-04's "workout assignments and progress" criterion)
 */
@Controller('v1/members/:memberId/pt')
export class PtTabController {
  constructor(
    private readonly enrollmentsService: PtEnrollmentsService,
    private readonly sessionsService: PtSessionsService,
    private readonly workoutsService: WorkoutsService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(
    { resource: 'pt', action: 'read' },
    { resource: 'workout', action: 'assignment-read' },
  )
  async getPt(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ): Promise<{
    enrollments: PTEnrollment[];
    sessions: PTSession[];
    workoutProgress: Array<{
      assignment: WorkoutPlanAssignment;
      progress: { completed: number; prescribed: number; percentage: number };
    }>;
  }> {
    const enrollmentsFilter: ListPtEnrollmentsDto = { member_id: memberId };
    const sessionsFilter: ListPtSessionsDto = { member_id: memberId };

    const [enrollments, sessions, assignments] = await Promise.all([
      this.enrollmentsService.findAll(enrollmentsFilter),
      this.sessionsService.findAll(sessionsFilter),
      this.workoutsService.findAllAssignments(memberId),
    ]);

    const workoutProgress = await Promise.all(
      assignments.map(async (assignment) => ({
        assignment,
        progress: await this.workoutsService.getAssignmentProgress(assignment.id),
      })),
    );

    return { enrollments, sessions, workoutProgress };
  }
}
