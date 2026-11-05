import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { WorkoutSessionsService } from '../services/workout-sessions.service';
import { WorkoutsTenantService } from '../services/workouts-tenant.service';
import { CreateWorkoutSessionDto } from '../dto/create-workout-session.dto';
import { UpdateWorkoutSessionDto } from '../dto/update-workout-session.dto';
import { ListWorkoutSessionsDto } from '../dto/list-workout-sessions.dto';

/**
 * Member workout-session lifecycle.
 *
 * Create/update/finish/cancel are the member actions. `DELETE` is the trainer
 * soft deletion (the row is retained; no reason is required). Every route is
 * organization-scoped; the member id is taken from the URL, never the body.
 */
@Controller('v1/workouts')
export class WorkoutSessionsController {
  constructor(
    private readonly sessions: WorkoutSessionsService,
    private readonly tenant: WorkoutsTenantService,
  ) {}

  @Get('members/:memberId/sessions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'session-read' })
  async listForMember(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Query() query: ListWorkoutSessionsDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.sessions.listMemberSessions(organizationId, memberId, query);
  }

  @Post('members/:memberId/sessions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'session-manage' })
  async create(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: CreateWorkoutSessionDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    const createdBy = await this.tenant.getCurrentUserId();
    return this.sessions.create(organizationId, memberId, dto, createdBy);
  }

  @Get('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'session-read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.sessions.getSession(organizationId, id);
  }

  @Patch('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'session-manage' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateWorkoutSessionDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.sessions.update(organizationId, id, dto);
  }

  @Post('sessions/:id/finish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'session-manage' })
  async finish(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.sessions.finish(organizationId, id);
  }

  @Post('sessions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'session-manage' })
  async cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.sessions.cancel(organizationId, id);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'session-manage' })
  async softDelete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    const deletedBy = await this.tenant.getCurrentUserId();
    return this.sessions.softDelete(organizationId, id, deletedBy);
  }
}
