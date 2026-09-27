import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { ReportSchemasService } from '../services/report-schemas.service';
import {
  CreateReportSchemaDto,
  QueryReportSchemasDto,
  UpdateReportSchemaDto,
} from '../dto/report-schema.dto';
import { ReportSchema } from '../entities/report-schema.entity';

/**
 * Report-schema CRUD (`docs/phase6-scoping-plan.md` §4.1, `docs/api-plan.md` §Reports).
 *
 * **Paths are §4.1's, verbatim**: `/v1/report/schemas` (not `/v1/reports`), and the update
 * route is `PUT` — §4.1 documents `PUT /v1/report/schemas/{id}` and defines no `PATCH`.
 * `docs/api-plan.md` lists the same collection, so both documents agree on the shape.
 *
 * `DELETE` is §4.1's "Delete a custom schema (reject system schemas)"; the refusal and
 * the deactivate-not-remove decision live in `ReportSchemasService`.
 *
 * **Permission** is the seeded `report` resource (§9.1), provisioned by
 * `1788965263404-ProvisionReportPermissions.ts`. Before that migration existed, every
 * route here would have answered 403 for everyone: permissions are rows, and
 * `PermissionsGuard` denies a resource with no rows — the same gap P6-28 hit with
 * `loyalty:read` and worked around with `member:read`.
 */
@Controller('v1/report/schemas')
export class ReportSchemasController {
  constructor(private readonly reportSchemasService: ReportSchemasService) {}

  /** §4.1: "List active report schemas (org-scoped)". */
  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'report', action: 'view' })
  async findAll(@Query() query: QueryReportSchemasDto) {
    return this.reportSchemasService.findAll(query);
  }

  /** §4.1: "Get schema details + parameter definitions". */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'report', action: 'view' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ReportSchema> {
    return this.reportSchemasService.findOne(id);
  }

  /**
   * §4.1: "Create a new custom report schema".
   *
   * The definition is validated by Phase A here, so an invalid `query_definition` is a
   * 400 at creation time rather than a failed job later.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'report', action: 'create' })
  async create(@Body() dto: CreateReportSchemaDto): Promise<ReportSchema> {
    return this.reportSchemasService.create(dto);
  }

  /** §4.1: "Update a custom schema" — system rows are refused by the service. */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'report', action: 'edit' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateReportSchemaDto,
  ): Promise<ReportSchema> {
    return this.reportSchemasService.update(id, dto);
  }

  /** §4.1: "Delete a custom schema (reject system schemas)". */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'report', action: 'delete' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ReportSchema> {
    return this.reportSchemasService.remove(id);
  }
}
