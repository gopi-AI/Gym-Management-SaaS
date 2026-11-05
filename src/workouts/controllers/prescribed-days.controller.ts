import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { WorkoutAssignmentsService } from '../services/workout-assignments.service';
import { WorkoutSessionsService } from '../services/workout-sessions.service';
import { WorkoutReviewsService } from '../services/workout-reviews.service';
import { WorkoutsTenantService } from '../services/workouts-tenant.service';
import { SubmitPlanDayDto } from '../dto/submit-plan-day.dto';
import { ReviewPlanDayDto } from '../dto/review-plan-day.dto';

/**
 * Prescribed workout days: the member opens the day, submits it for review, and
 * the trainer approves it or asks for the remaining exercises.
 *
 * The prescribed day is the stable identity across every session and every
 * submission. Submitting never approves the day; only the trainer review does.
 */
@Controller('v1/workouts/prescribed-days')
export class PrescribedDaysController {
  constructor(
    private readonly assignments: WorkoutAssignmentsService,
    private readonly sessions: WorkoutSessionsService,
    private readonly reviews: WorkoutReviewsService,
    private readonly tenant: WorkoutsTenantService,
  ) {}

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    const day = await this.assignments.getPrescribedDayDetail(
      organizationId,
      id,
    );
    const [assignment, submissions, reviews, sessions] = await Promise.all([
      this.assignments.getAssignment(organizationId, day.assignment_id),
      this.sessions.listDaySubmissions(organizationId, id),
      this.reviews.listDayReviews(organizationId, id),
      this.sessions.listPrescribedDaySessions(organizationId, id),
    ]);
    return { day, assignment, submissions, reviews, sessions };
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'session-manage' })
  async submit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitPlanDayDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    const submittedBy = await this.tenant.getCurrentUserId();
    return this.sessions.submitDay(organizationId, id, dto, submittedBy);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'assignment-manage' })
  async review(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReviewPlanDayDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    const reviewedBy = await this.tenant.getCurrentUserId();
    return this.reviews.reviewDay(organizationId, id, dto, reviewedBy);
  }

  @Get(':id/submissions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'session-read' })
  async submissions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.sessions.listDaySubmissions(organizationId, id);
  }

  @Get(':id/reviews')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async reviewsForDay(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.reviews.listDayReviews(organizationId, id);
  }
}
