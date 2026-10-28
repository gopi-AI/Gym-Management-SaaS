import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { DietService } from '../services/diet.service';
import { CreateMealTemplateDto } from '../dto/create-meal-template.dto';
import { UpdateMealTemplateDto } from '../dto/update-meal-template.dto';
import { QueryMealTemplateDto } from '../dto/query-meal-template.dto';
import { MealTemplate } from '../entities/meal-template.entity';

/**
 * Meal-template routes (flat collection, `v1/meal-templates`).
 *
 * Route layer only — every method delegates to `DietService`, which owns the
 * single legal write path and resolves the authorized organization from the
 * tenant context. Nothing here accepts `organization_id` from the client: the
 * `@Body()` metatypes are concrete DTOs with no such field, so the global
 * `ValidationPipe({ whitelist: true })` strips it before the handler runs.
 *
 * Authorization is opt-in per handler (`PermissionsGuard` passes undecorated
 * handlers), so each route carries its own decorator:
 *   - reads  -> `diet:template-read`
 *   - writes -> `diet:template-manage`
 *
 * Deletion is a guarded hard delete: `DietService.deleteMealTemplate()` answers
 * 409 when a nutrition log still references the template, 404 when the id is
 * not in the caller's organization, and 204 on success.
 */
@Controller('v1/meal-templates')
export class MealTemplatesController {
  constructor(private readonly dietService: DietService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'diet', action: 'template-read' })
  async findAll(@Query() query: QueryMealTemplateDto): Promise<MealTemplate[]> {
    return this.dietService.findAllMealTemplates(query?.dietPlanId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'diet', action: 'template-read' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<MealTemplate> {
    return this.dietService.findMealTemplateById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'diet', action: 'template-manage' })
  async create(@Body() dto: CreateMealTemplateDto): Promise<MealTemplate> {
    return this.dietService.createMealTemplate(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'diet', action: 'template-manage' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateMealTemplateDto,
  ): Promise<MealTemplate> {
    return this.dietService.updateMealTemplate(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'diet', action: 'template-manage' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    await this.dietService.deleteMealTemplate(id);
  }
}
