import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { workerIntervalMs } from '../../shared/workers/worker-config';
import { ReportJob } from '../entities/report-job.entity';
import { ReportJobService } from './report-job.service';
import { ReportSchemasService } from './report-schemas.service';
import { throwAsHttpException } from '../errors/report-error.http';
import { ExecuteReportDto, ReportJobResponse, toReportJobResponse } from '../dto/report-job.dto';

/**
 * HTTP-facing report-job service (§4.2).
 *
 * **Why this is not Phase B's `ReportJobService`.** `report-job.service.ts` (Phase B,
 * committed) owns the *lifecycle*: creating rows, the Redis queue-depth guard, the
 * locked claim, execution and the terminal transitions. This file owns what an HTTP
 * caller needs on top of it and nothing else:
 *   1. the tenant-scoped read of one job (§4.2's status route), which Phase B does not
 *      expose, and
 *   2. the schema-active check and domain-error → HTTP translation for the trigger.
 * It deliberately contains no execution logic: `createJob()` is called as-is, so there
 * is exactly one implementation of creating a job.
 *
 * The near-identical file names are intentional and are the plan's (§2.1 lists
 * `report-jobs.service.ts`); the class names differ, and each docblock names the other,
 * so the split is visible rather than confusing.
 *
 * **Executing a deactivated schema is refused.** `GET /v1/report/schemas` lists active
 * schemas only (§4.1) and `DELETE` deactivates, so a deactivated schema must not remain
 * runnable through a cached id. The check happens here rather than in Phase B because
 * `createJob()` does not test `is_active` and Phase B must not be modified; the extra
 * lookup is one indexed SELECT and doubles as the tenant-scoped 404.
 */
@Injectable()
export class ReportJobsService {
  constructor(
    @InjectRepository(ReportJob)
    private readonly jobRepository: Repository<ReportJob>,
    private readonly reportJobService: ReportJobService,
    private readonly reportSchemasService: ReportSchemasService,
    private readonly tenantContextService: TenantContextService,
    private readonly configService: ConfigService,
  ) {}

  /** The AUTHORIZED organization for this request (never a client-supplied id). */
  private async resolveAuthorizedOrg(): Promise<string> {
    const organizationId = await this.tenantContextService.getCurrentOrganizationId();
    if (organizationId) {
      return organizationId;
    }
    throw new NotFoundException('No authorized organization in the request context');
  }

  /**
   * §10's `Retry-After` value: the worker's own drain cadence, read from the same
   * configuration the worker uses (`WORKERS_REPORT_JOBS_INTERVAL_MS`, default 15s), so an
   * operator who retunes the worker does not leave the header stale. A slot frees when a
   * claimed job reaches a terminal state, which the next tick is what performs.
   */
  private retryAfterSeconds(): number {
    return Math.max(1, Math.ceil(workerIntervalMs(this.configService, 'REPORT_JOBS') / 1000));
  }

  /**
   * `POST /v1/report/schemas/{id}/execute` — create a pending job (§4.1/§4.2).
   *
   * Order: authorize the organization → resolve the schema *inside* it (404 otherwise)
   * → refuse a deactivated schema (409) → hand off to Phase B. The queue-depth guard
   * lives in Phase B and is translated here, so a refusal past `MAX_PENDING_JOBS` is a
   * 429 carrying the current pending count and a `Retry-After` hint (§10).
   */
  async execute(schemaId: string, dto: ExecuteReportDto): Promise<ReportJobResponse> {
    const organizationId = await this.resolveAuthorizedOrg();
    const schema = await this.reportSchemasService.findOne(schemaId);

    if (!schema.is_active) {
      throw new ConflictException('Report schema is deactivated and cannot be executed');
    }

    try {
      const job = await this.reportJobService.createJob({
        organizationId,
        schemaId: schema.id,
        parameters: dto.parameters,
        createdBy: await this.tenantContextService.getCurrentUserId(),
      });
      return toReportJobResponse(job);
    } catch (error) {
      throwAsHttpException(error, { retryAfterSeconds: this.retryAfterSeconds() });
    }
  }

  /**
   * `GET /v1/report/jobs/{id}` (§4.2) — status, progress and result metadata.
   *
   * The read is organization-scoped, so another tenant's job id is a 404.
   */
  async findOne(jobId: string): Promise<ReportJobResponse> {
    const organizationId = await this.resolveAuthorizedOrg();
    const job = await this.jobRepository.findOne({
      where: { id: jobId, organization_id: organizationId },
    });
    if (!job) {
      throw new NotFoundException('Report job not found');
    }
    return toReportJobResponse(job);
  }
}
