import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { ReportSchema } from '../entities/report-schema.entity';
import { ReportQueryValidator } from './report-query-validator.service';
import { throwAsHttpException } from '../errors/report-error.http';
import {
  CreateReportSchemaDto,
  QueryReportSchemasDto,
  UpdateReportSchemaDto,
} from '../dto/report-schema.dto';
import type { QueryDefinition } from '../types/query-definition';

/**
 * Report-schema CRUD (§4.1, `docs/api-plan.md` §Reports).
 *
 * **Tenancy** follows `MembershipPlansService` exactly: the authorized organization
 * comes from `TenantContextService` (current context, else the requested organization
 * validated against an active membership) and *every* query carries
 * `organization_id`. A schema id belonging to another organization is therefore a 404,
 * never a 403 that would confirm the row exists.
 *
 * **Creation validates through Phase A, unchanged.** `ReportQueryValidator` is called
 * with the authorized organization before anything is written, so an unknown source, an
 * unknown column, a bad aggregate or a bad bucket unit is rejected as a 400 at creation
 * time — the requirement that the catalog cannot be filled with definitions that only
 * fail later (§3.1.1). Phase B's `ReportJobService` then re-validates at execution, which
 * is what makes §10's schema-drift case (a column dropped after the schema was saved)
 * fail the *job* rather than the schema.
 *
 * **System schemas are immutable here.** §6's preamble says system rows "cannot be
 * deleted by users", and §4.1's `PUT` is documented as "Update a **custom** schema", so
 * both `update()` and `remove()` refuse `is_system = true` with 403. Seeding those rows
 * is P6-07's job, not an API caller's.
 *
 * **`DELETE` deactivates rather than removes.** `REPORTS_REPORT_JOBS.report_schema_id`
 * references this table `ON DELETE NO ACTION`, so a hard delete would raise a foreign-key
 * violation for any schema that has ever been executed — i.e. in normal use. Setting
 * `is_active = false` matches §4.1's "List **active** report schemas", preserves the job
 * log, and is reversible through `PUT`.
 */
@Injectable()
export class ReportSchemasService {
  constructor(
    @InjectRepository(ReportSchema)
    private readonly schemaRepository: Repository<ReportSchema>,
    private readonly tenantContextService: TenantContextService,
    private readonly validator: ReportQueryValidator,
  ) {}

  /** The AUTHORIZED organization for this request (never a client-supplied id). */
  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new ForbiddenException('Organization context required');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /**
   * Phase A's validation, mapped to a 400. Run on create and on any update that
   * supplies a definition, so a stored definition is always one that validated against
   * the entity metadata of the moment.
   */
  private async assertDefinitionIsValid(
    definition: QueryDefinition,
    organizationId: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.validator.validate(definition, { organizationId, parameters });
    } catch (error) {
      throwAsHttpException(error);
    }
  }

  async findAll(
    query: QueryReportSchemasDto,
  ): Promise<{ data: ReportSchema[]; total: number; page: number; limit: number }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    // §4.1 scopes this list to ACTIVE schemas. Deactivated rows stay reachable by id.
    const [data, total] = await this.schemaRepository.findAndCount({
      where: { organization_id: organizationId, is_active: true },
      order: { name: 'ASC' },
      take: limit,
      skip,
    });

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<ReportSchema> {
    const organizationId = await this.resolveAuthorizedOrg();
    const schema = await this.schemaRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!schema) {
      throw new NotFoundException('Report schema not found');
    }
    return schema;
  }

  async create(dto: CreateReportSchemaDto): Promise<ReportSchema> {
    const organizationId = await this.resolveAuthorizedOrg();
    await this.assertDefinitionIsValid(dto.query_definition, organizationId);

    return this.schemaRepository.save({
      organization_id: organizationId,
      name: dto.name,
      description: dto.description ?? null,
      category: dto.category ?? 'custom',
      query_definition: dto.query_definition,
      parameters: dto.parameters ?? [],
      // Never settable by a caller: system rows are seeded (P6-07).
      is_system: false,
      is_active: true,
      created_by: (await this.tenantContextService.getCurrentUserId()) ?? null,
    });
  }

  async update(id: string, dto: UpdateReportSchemaDto): Promise<ReportSchema> {
    const organizationId = await this.resolveAuthorizedOrg();
    const schema = await this.findOne(id);

    if (schema.is_system) {
      throw new ForbiddenException('System report schemas cannot be modified');
    }

    if (dto.query_definition) {
      await this.assertDefinitionIsValid(dto.query_definition, organizationId);
    }

    // Assigned field by field rather than spread: `organization_id`, `is_system` and
    // `id` must not be writable through a request body.
    if (dto.name !== undefined) schema.name = dto.name;
    if (dto.description !== undefined) schema.description = dto.description;
    if (dto.category !== undefined) schema.category = dto.category;
    if (dto.query_definition !== undefined) schema.query_definition = dto.query_definition;
    if (dto.parameters !== undefined) schema.parameters = dto.parameters;
    if (dto.is_active !== undefined) schema.is_active = dto.is_active;

    return this.schemaRepository.save(schema);
  }

  /** §4.1's DELETE: reject system schemas, deactivate custom ones (see the class note). */
  async remove(id: string): Promise<ReportSchema> {
    const schema = await this.findOne(id);

    if (schema.is_system) {
      throw new ForbiddenException('System report schemas cannot be deleted');
    }

    schema.is_active = false;
    return this.schemaRepository.save(schema);
  }
}
