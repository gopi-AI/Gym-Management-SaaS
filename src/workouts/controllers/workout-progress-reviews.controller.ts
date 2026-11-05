import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { WorkoutReviewsService } from '../services/workout-reviews.service';
import { WorkoutsTenantService } from '../services/workouts-tenant.service';
import { CreateProgressReviewDto } from '../dto/create-progress-review.dto';
import { ListProgressReviewsDto } from '../dto/list-progress-reviews.dto';

/**
 * Trainer-led 30–45-day progress reviews.
 *
 * A review is a historical snapshot: progress counts, attendance summary and
 * measurement references are frozen. It does not expire or advance a plan.
 */
@Controller('v1/workouts')
export class WorkoutProgressReviewsController {
  constructor(
    private readonly reviews: WorkoutReviewsService,
    private readonly tenant: WorkoutsTenantService,
  ) {}

  @Get('members/:memberId/progress-reviews')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async list(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Query() query: ListProgressReviewsDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.reviews.listProgressReviews(
      organizationId,
      memberId,
      query,
    );
  }

  @Get('members/:memberId/progress-reviews/comparison')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async comparison(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.reviews.getComparison(organizationId, memberId);
  }

  @Post('members/:memberId/progress-reviews')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'assignment-manage' })
  async create(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: CreateProgressReviewDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    const reviewedBy = await this.tenant.getCurrentUserId();
    return this.reviews.createProgressReview(
      organizationId,
      memberId,
      dto,
      reviewedBy,
    );
  }

  @Get('progress-reviews/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.reviews.getProgressReview(organizationId, id);
  }
}
