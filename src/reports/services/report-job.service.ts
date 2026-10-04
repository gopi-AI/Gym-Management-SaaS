import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ReportJob } from '../entities/report-job.entity';
import { ReportSchema } from '../entities/report-schema.entity';
import { ReportQueryValidator } from './report-query-validator.service';
import { ReportQueryBuilder } from './report-query-builder.service';
import { ReportJobError } from '../errors/report-job.errors';
import type { QueryDefinition } from '../types/query-definition';

/** §3.2's queue-depth guard default, in one place. */
export const DEFAULT_MAX_PENDING_JOBS = 2;

/**
 * Job orchestration for report execution (Phase B, P6-02/P6-03).
 *
 * Phase A validates and compiles; this service owns the async path around it —
 * `createJob()` with §3.2's queue-depth guard, `runPendingBatch()` (claim, execute,
 * record) and the terminal transitions.
 *
 * **Ad-hoc definitions become schema rows.** `REPORTS_REPORT_JOBS` has no column for a
 * `QueryDefinition` (its `parameters` column holds filter *values*), so an ad-hoc job
 * persists its definition as a `REPORTS_REPORT_SCHEMAS` row and references it. The
 * worker therefore has exactly one path — load schema, read definition, execute — so
 * ad-hoc and saved reports are validated and run identically rather than by two paths
 * that could drift.
 *
 * **Results are metrics only.** `result_rows` and `result_format` are written; the rows
 * are not persisted, because the table stores results by S3 key and no bucket is
 * configured. That gap is filed as P6-36 rather than forced into a column that does not
 * exist.
 */
@Injectable()
export class ReportJobService {
  constructor(
    @InjectRepository(ReportJob)
    private readonly jobRepository: Repository<ReportJob>,
    @InjectRepository(ReportSchema)
    private readonly schemaRepository: Repository<ReportSchema>,
    private readonly dataSource: DataSource,
    private readonly validator: ReportQueryValidator,
    private readonly builder: ReportQueryBuilder,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  /** Redis key for an organization's outstanding pending-job count (§3.2). */
  private pendingKey(organizationId: string): string {
    return `reports:jobs:pending:${organizationId}`;
  }

  private maxPendingJobs(): number {
    const configured = Number(this.configService.get<string>('MAX_PENDING_JOBS'));
    if (Number.isFinite(configured) && configured > 0) return configured;
    return DEFAULT_MAX_PENDING_JOBS;
  }

  /**
   * Outstanding pending jobs for an organization, from Redis rather than the database
   * (§3.2: "Redis counter, not a DB column").
   *
   * `cache-manager`'s interface has no INCR, so the increment/decrement below are
   * read-modify-write and not atomic across processes. That makes the cap best-effort
   * under concurrent creators — acceptable for a guard §3.2 words as "SHOULD NOT
   * exceed", and stated here rather than left for someone to discover.
   */
  async getPendingCount(organizationId: string): Promise<number> {
    return (await this.cacheManager.get<number>(this.pendingKey(organizationId))) ?? 0;
  }

  private async incrementPending(organizationId: string): Promise<void> {
    const next = (await this.getPendingCount(organizationId)) + 1;
    await this.cacheManager.set(this.pendingKey(organizationId), next);
  }

  /**
   * Decrements on **terminal state, regardless of outcome**: a failed job must free its
   * slot as surely as a completed one, or an organization that hit the cap with failures
   * could never queue again.
   */
  private async decrementPending(organizationId: string): Promise<void> {
    const next = Math.max(0, (await this.getPendingCount(organizationId)) - 1);
    await this.cacheManager.set(this.pendingKey(organizationId), next);
  }

  /**
   * Creates a pending job, enforcing §3.2's queue-depth guard.
   *
   * An ad-hoc `definition` is persisted as a schema row first, so no job row can exist
   * whose work cannot be reconstructed by the worker.
   */
  async createJob(input: {
    organizationId: string;
    createdBy?: string | null;
    schemaId?: string;
    definition?: QueryDefinition;
    parameters?: Record<string, unknown>;
    name?: string;
  }): Promise<ReportJob> {
    const { organizationId, createdBy, schemaId, definition, parameters, name } = input;

    if (!schemaId && !definition) {
      throw new ReportJobError(
        'JOB_HAS_NO_DEFINITION',
        'A job needs either an existing report schema or an ad-hoc definition.',
      );
    }

    const pending = await this.getPendingCount(organizationId);
    const max = this.maxPendingJobs();
    if (pending >= max) {
      throw new ReportJobError(
        'QUEUE_DEPTH_EXCEEDED',
        `Organization already holds ${pending} pending job(s); the limit is ${max}.`,
        { organizationId, pending, max },
      );
    }

    let resolvedSchemaId = schemaId ?? null;
    if (!resolvedSchemaId) {
      const schema = await this.schemaRepository.save({
        organization_id: organizationId,
        name: name ?? `Ad-hoc report ${new Date().toISOString()}`,
        category: 'custom',
        query_definition: definition as QueryDefinition,
        created_by: createdBy ?? null,
      });
      resolvedSchemaId = schema.id;
    } else {
      const exists = await this.schemaRepository.findOne({
        where: { id: resolvedSchemaId, organization_id: organizationId },
      });
      if (!exists) {
        throw new ReportJobError('SCHEMA_NOT_FOUND', 'Report schema not found.', {
          organizationId,
          schemaId: resolvedSchemaId,
        });
      }
    }

    const job = await this.jobRepository.save({
      organization_id: organizationId,
      report_schema_id: resolvedSchemaId,
      status: 'pending',
      parameters: (parameters ?? {}) as Record<string, unknown>,
      created_by: createdBy ?? null,
    });

    await this.incrementPending(organizationId);
    return job;
  }

  /**
   * Runs one batch of pending jobs.
   *
   * Mirrors `MembershipsService.expireDueMemberships`: select candidates without a lock,
   * then for each one re-validate **under a row lock in its own transaction** before
   * doing any work. A candidate another tick (or another instance) already claimed is
   * skipped, which is what prevents double-processing without holding a lock for the
   * duration of a report.
   */
  async runPendingBatch(limit: number): Promise<{
    scanned: number;
    completed: number;
    failed: number;
    skipped: number;
  }> {
    const candidates = await this.jobRepository.find({
      where: { status: 'pending' },
      order: { created_at: 'ASC' },
      take: limit,
    });

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const claimed = await this.claim(candidate.id);
      if (!claimed) {
        skipped += 1;
        continue;
      }
      const outcome = await this.execute(claimed);
      if (outcome === 'completed') completed += 1;
      else failed += 1;
    }

    return { scanned: candidates.length, completed, failed, skipped };
  }

  /**
   * `pending → running` under a write lock, re-checking the status inside the lock.
   * Returns null when the row is gone or no longer pending.
   */
  private async claim(jobId: string): Promise<ReportJob | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ReportJob);
      const job = await repository.findOne({
        where: { id: jobId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job || job.status !== 'pending') return null;

      job.status = 'running';
      job.started_at = new Date();
      job.progress_pct = 1;
      return repository.save(job);
    });
  }

  /**
   * Runs one claimed job through Phase A and records its terminal state.
   *
   * `completed` writes `result_rows`/`result_format`/`progress_pct`/`completed_at`.
   * `failed` writes `error_message` — including a Phase A `ReportQueryValidationError`,
   * whose message is written for a human ("Column X does not exist on Member"), which is
   * exactly what §10's schema-drift row wants recorded when a column disappears after the
   * definition was saved.
   *
   * **Both paths decrement the pending counter** (the failure path via `finally`), so a
   * job that fails frees its queue slot instead of consuming the organization's cap for
   * ever.
   */
  private async execute(job: ReportJob): Promise<'completed' | 'failed'> {
    try {
      const schema = job.report_schema_id
        ? await this.schemaRepository.findOne({
            where: { id: job.report_schema_id, organization_id: job.organization_id },
          })
        : null;
      if (!schema) {
        throw new Error(
          `Report schema ${job.report_schema_id} not found for organization ${job.organization_id}`,
        );
      }

      const validated = await this.validator.validate(schema.query_definition, {
        organizationId: job.organization_id,
        parameters: (job.parameters ?? {}) as Record<string, unknown>,
      });
      const rows = await this.builder.build(validated).getRawMany<Record<string, unknown>>();

      await this.jobRepository.update(job.id, {
        status: 'completed',
        result_rows: rows.length,
        result_format: 'json',
        progress_pct: 100,
        completed_at: new Date(),
        error_message: null,
      });
      return 'completed';
    } catch (error) {
      await this.jobRepository.update(job.id, {
        status: 'failed',
        error_message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
        completed_at: new Date(),
      });
      return 'failed';
    } finally {
      await this.decrementPending(job.organization_id);
    }
  }
}
