import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { WorkoutTemplatesService } from '../services/workout-templates.service';
import { WorkoutsTenantService } from '../services/workouts-tenant.service';
import { CreateWorkoutPlanTemplateDto } from '../dto/create-workout-plan-template.dto';
import { UpdateWorkoutPlanTemplateDto } from '../dto/update-workout-plan-template.dto';
import { SetPlanTemplateDaysDto } from '../dto/set-plan-template-days.dto';

/**
 * Reusable weekly workout-plan templates.
 *
 * The ordered day list is a stable rolling sequence, not a fixed weekday
 * calendar. Days can repeat a composition, vary it, be optional, or be rest
 * markers.
 */
@Controller('v1/workouts/plan-templates')
export class WorkoutPlanTemplatesController {
  constructor(
    private readonly templates: WorkoutTemplatesService,
    private readonly tenant: WorkoutsTenantService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-read' })
  async findAll() {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.listPlanTemplates(organizationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'template-manage' })
  async create(@Body() dto: CreateWorkoutPlanTemplateDto) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.createPlanTemplate(organizationId, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.getPlanTemplate(organizationId, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-manage' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateWorkoutPlanTemplateDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.updatePlanTemplate(organizationId, id, dto);
  }

  @Put(':id/days')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-manage' })
  async setDays(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetPlanTemplateDaysDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.setPlanTemplateDays(organizationId, id, dto);
  }
}
