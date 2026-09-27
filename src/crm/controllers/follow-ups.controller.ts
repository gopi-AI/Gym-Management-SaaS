import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { FollowUpsService } from '../services/follow-ups.service';
import { CompleteFollowUpDto, ListDueFollowUpsDto } from '../dto/follow-up.dto';

/**
 * P3-07 — §9's follow-up API surface.
 *
 * `GET /v1/follow-ups/due` and `POST /v1/follow-ups/{id}/complete` are the two
 * endpoints `docs/task-backlog.md` names for P3-07; both reuse §9's existing
 * `crm:read` / `crm:update` pair rather than inventing new actions.
 */
@Controller('v1/follow-ups')
export class FollowUpsController {
  constructor(private readonly service: FollowUpsService) {}

  @Get('due')
  @RequirePermissions({ resource: 'crm', action: 'read' })
  due(@Query() dto: ListDueFollowUpsDto) {
    return this.service.listDue(dto);
  }

  @Post(':id/complete')
  @RequirePermissions({ resource: 'crm', action: 'update' })
  complete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CompleteFollowUpDto,
  ) {
    return this.service.complete(id, dto);
  }
}
