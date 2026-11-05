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
import { WorkoutsTenantService } from '../services/workouts-tenant.service';
import { CreateAssignmentDto } from '../dto/create-assignment.dto';

/**
 * Member plan assignment and the rolling workout sequence.
 *
 * The member id is the route parameter; the organization is the authorized
 * request context. Assignment snapshots the weekly template so later template
 * edits cannot change this member's plan.
 */
@Controller('v1/workouts')
export class WorkoutAssignmentsController {
  constructor(
    private readonly assignments: WorkoutAssignmentsService,
    private readonly tenant: WorkoutsTenantService,
  ) {}

  @Get('members/:memberId/assignments')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async listForMember(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.assignments.listAssignmentsForMember(
      organizationId,
      memberId,
    );
  }

  @Post('members/:memberId/assignments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'assignment-manage' })
  async assign(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    const assignedBy = await this.tenant.getCurrentUserId();
    return this.assignments.assignPlanTemplate(
      organizationId,
      memberId,
      dto,
      assignedBy,
    );
  }

  @Get('assignments/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.assignments.getAssignmentDetail(organizationId, id);
  }

  @Get('members/:memberId/sequence')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'assignment-read' })
  async sequence(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.assignments.getSequence(organizationId, memberId);
  }
}
