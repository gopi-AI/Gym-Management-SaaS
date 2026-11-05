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
import { CreateWorkoutDayTemplateDto } from '../dto/create-workout-day-template.dto';
import { UpdateWorkoutDayTemplateDto } from '../dto/update-workout-day-template.dto';
import { SetDayTemplateExercisesDto } from '../dto/set-day-template-exercises.dto';
import { CopyWorkoutDayTemplateDto } from '../dto/copy-workout-day-template.dto';

/**
 * Reusable workout-day templates.
 *
 * A template is composed here and copied into independent day templates; the
 * copy operation never shares rows with its source.
 */
@Controller('v1/workouts/day-templates')
export class WorkoutDayTemplatesController {
  constructor(
    private readonly templates: WorkoutTemplatesService,
    private readonly tenant: WorkoutsTenantService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-read' })
  async findAll() {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.listDayTemplates(organizationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'template-manage' })
  async create(@Body() dto: CreateWorkoutDayTemplateDto) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.createDayTemplate(organizationId, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.getDayTemplate(organizationId, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-manage' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateWorkoutDayTemplateDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.updateDayTemplate(organizationId, id, dto);
  }

  @Put(':id/exercises')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'workout', action: 'template-manage' })
  async setExercises(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetDayTemplateExercisesDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.setDayTemplateExercises(organizationId, id, dto);
  }

  @Post(':id/copy')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'workout', action: 'template-manage' })
  async copy(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CopyWorkoutDayTemplateDto,
  ) {
    const organizationId = await this.tenant.getOrganizationId();
    return this.templates.copyDayTemplate(organizationId, id, dto);
  }
}
