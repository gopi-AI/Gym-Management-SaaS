import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createCache, type Cache } from 'cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { DataSource, Repository } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Member } from '../../members/entities/member.entity';
import { IdentityPermission } from '../../identity/entities/identity-permissions.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';
import { ReportJob } from '../entities/report-job.entity';
import { ReportSchema } from '../entities/report-schema.entity';
import { ReportQueryValidator } from '../services/report-query-validator.service';
import { ReportQueryBuilder } from '../services/report-query-builder.service';
import { ReportJobService } from '../services/report-job.service';
import { ReportSchemasService } from '../services/report-schemas.service';
import { ReportJobsService } from '../services/report-jobs.service';
import { ReportSchemasController } from './report-schemas.controller';
import { ReportJobsController } from './report-jobs.controller';
import type {
  CreateReportSchemaDto,
  QueryReportSchemasDto,
  UpdateReportSchemaDto,
} from '../dto/report-schema.dto';

jest.setTimeout(120_000);

const ENABLED = Boolean(process.env.DB_HOST);
const describeDb = ENABLED ? describe : describe.skip;

/**
 * HTTP-surface proof for P6-04 piece 1 (§4.1/§4.2), against a real database and Redis.
 *
 * **Why the controllers rather than a booted HTTP server.** This repository has no
 * `supertest` dependency and no e2e harness, so the deepest honest level is the real
 * controller instance wired to the real services, the real `ReportQueryValidator` /
 * `ReportQueryBuilder` and a real `DataSource` — the same depth P6-28's tenant-isolation
 * spec proves its reads at. Every response printed below is what the controller actually
 * returned, or the exception it actually threw; no repository or service is mocked, and
 * the isolation assertions check that another organization's rows are *absent* rather
 * than that a `where` clause was passed.
 *
 * The 429 path drives the real `ReportJobsController.execute()` with a stub response
 * object, which is what proves the `Retry-After` header is set by shipped code.
 */
describeDb('Report API over HTTP (P6-04 piece 1)', () => {
  let ds: DataSource;
  let cache: Cache;
  let store: Awaited<ReturnType<typeof redisStore>>;
  let tenantContext: TenantContextService;
  let reportJobService: ReportJobService;
  let schemasController: ReportSchemasController;
  let jobsController: ReportJobsController;
  let jobRepository: Repository<ReportJob>;
  let schemaRepository: Repository<ReportSchema>;

  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const branchA = crypto.randomUUID();

  const reflector = new Reflector();

  /** Run `fn` as if the request had been authorized for `orgId`. */
  const asOrg = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
    tenantContext.runWithContext({}, async () => {
      await tenantContext.setCurrentOrganizationId(orgId);
      return fn();
    });

  const logPair = (label: string, request: unknown, response: unknown) => {
    console.log(
      `[report-api evidence] ${label} request=${JSON.stringify(request)} response=${JSON.stringify(response)}`,
    );
  };

  /** The exception a handler threw, as an HTTP status + body pair. */
  const catchHttp = async (
    fn: () => Promise<unknown>,
  ): Promise<{ status: number; body: unknown; name: string }> => {
    try {
      await fn();
    } catch (error) {
      const http = error as HttpException;
      return {
        status: http.getStatus(),
        body: http.getResponse(),
        name: (error as Error).name,
      };
    }
    throw new Error('Expected the call to throw, but it resolved.');
  };

  beforeAll(async () => {
    ds = AppDataSource;
    await ds.initialize();
    await ds.runMigrations();

    jobRepository = ds.getRepository(ReportJob);
    schemaRepository = ds.getRepository(ReportSchema);

    tenantContext = new TenantContextService({} as never, ds.getRepository(Branch));
    const validator = new ReportQueryValidator(ds);
    const builder = new ReportQueryBuilder(ds);

    store = await redisStore({ url: 'redis://127.0.0.1:6379', database: 0 });
    cache = createCache(store);

    // `MAX_PENDING_JOBS` is pinned to the documented default (2) rather than left to
    // whatever the environment sets, so the guard's cap is deterministic here.
    const configService = {
      get: (key: string) => (key === 'MAX_PENDING_JOBS' ? '2' : undefined),
    } as ConfigService;

    reportJobService = new ReportJobService(
      jobRepository as never,
      schemaRepository as never,
      ds,
      validator,
      builder,
      cache,
      configService,
    );

    const reportSchemasService = new ReportSchemasService(
      schemaRepository as never,
      tenantContext,
      validator,
    );
    const reportJobsService = new ReportJobsService(
      jobRepository as never,
      reportJobService,
      reportSchemasService,
      tenantContext,
      configService,
    );

    schemasController = new ReportSchemasController(reportSchemasService);
    jobsController = new ReportJobsController(reportJobsService);

    await ds.getRepository(Organization).save([
      { id: orgA, name: 'report-api-a', timezone: 'UTC', locale: 'en-US', currency: 'USD' },
      { id: orgB, name: 'report-api-b', timezone: 'UTC', locale: 'en-US', currency: 'USD' },
    ]);
    await ds.getRepository(Branch).save({
      id: branchA,
      organization_id: orgA,
      name: 'A',
      address: 'a',
      phone: '1',
    });
    await ds.getRepository(Member).save({
      id: crypto.randomUUID(),
      organization_id: orgA,
      branch_id: branchA,
      global_uuid: crypto.randomUUID(),
      local_id: 1,
      first_name: 'Api',
      last_name: 'Fixture',
    });

    await cache.del(`reports:jobs:pending:${orgA}`);
    await cache.del(`reports:jobs:pending:${orgB}`);
  });

  afterEach(async () => {
    await jobRepository.delete({ organization_id: orgA });
    await jobRepository.delete({ organization_id: orgB });
    await schemaRepository.delete({ organization_id: orgA });
    await schemaRepository.delete({ organization_id: orgB });
    await cache.set(`reports:jobs:pending:${orgA}`, 0);
    await cache.set(`reports:jobs:pending:${orgB}`, 0);
  });

  afterAll(async () => {
    await ds.getRepository(Member).delete({ organization_id: orgA });
    await ds.getRepository(Branch).delete({ organization_id: orgA });
    await ds.getRepository(Organization).delete([{ id: orgA }, { id: orgB }]);
    await cache.del(`reports:jobs:pending:${orgA}`);
    await cache.del(`reports:jobs:pending:${orgB}`);
    await store.client.quit();
    await ds.destroy();
  });

  it('creates a custom schema from a QueryDefinition and rejects an invalid one with 400', async () => {
    const request: CreateReportSchemaDto = {
      name: 'Members by month',
      description: 'Created through the endpoint',
      category: 'member',
      query_definition: {
        source: 'Member',
        columns: {
          month: { bucket: 'created_at', unit: 'month' },
          total: { fn: 'COUNT', column: '*' },
        },
        group_by: ['month'],
      },
      parameters: [],
    };

    const created = await asOrg(orgA, () => schemasController.create(request));
    logPair('POST /v1/report/schemas (valid)', request, created);

    expect(created.organization_id).toBe(orgA);
    expect(created.is_system).toBe(false);
    expect(created.is_active).toBe(true);
    expect(created.category).toBe('member');

    // Unknown column: Phase A's validator rejects it BEFORE a row exists.
    const badColumn: CreateReportSchemaDto = {
      name: 'Bad column',
      query_definition: { source: 'Member', columns: { nope: 'no_such_column' } },
    };
    const badColumnResult = await asOrg(orgA, () =>
      catchHttp(() => schemasController.create(badColumn)),
    );
    logPair('POST /v1/report/schemas (unknown column)', badColumn, badColumnResult);

    expect(badColumnResult.status).toBe(HttpStatus.BAD_REQUEST);
    expect(badColumnResult.name).toBe(BadRequestException.name);
    expect((badColumnResult.body as { code: string }).code).toBe('UNKNOWN_COLUMN');
    expect(await schemaRepository.count({ where: { organization_id: orgA } })).toBe(1);

    // Unknown source: same 400 family, and again nothing is stored.
    const badSource = {
      name: 'Bad source',
      query_definition: { source: 'NotAnEntity', columns: { id: 'id' } },
    } as CreateReportSchemaDto;
    const badSourceResult = await asOrg(orgA, () =>
      catchHttp(() => schemasController.create(badSource)),
    );
    logPair('POST /v1/report/schemas (unknown source)', badSource, badSourceResult);
    expect(badSourceResult.status).toBe(HttpStatus.BAD_REQUEST);
    expect((badSourceResult.body as { code: string }).code).toBe('UNKNOWN_SOURCE');
    expect(await schemaRepository.count({ where: { organization_id: orgA } })).toBe(1);
  });

  it('lists and fetches only the calling organization schemas, and 404s a cross-org id', async () => {
    const countDefinition = {
      source: 'Member',
      columns: { total: { fn: 'COUNT', column: '*' } },
    };
    const mine = await asOrg(orgA, () =>
      schemasController.create({
        name: 'A-only report',
        category: 'member',
        query_definition: countDefinition,
      } as CreateReportSchemaDto),
    );
    const theirs = await asOrg(orgB, () =>
      schemasController.create({
        name: 'B-only report',
        category: 'member',
        query_definition: countDefinition,
      } as CreateReportSchemaDto),
    );

    const list = await asOrg(orgA, () =>
      schemasController.findAll({ page: 1, limit: 20 } as QueryReportSchemasDto),
    );
    logPair('GET /v1/report/schemas (as org A)', { page: 1, limit: 20 }, list);

    // Absence of the other tenant's row, not merely a passed-in filter.
    expect(list.data.map((row) => row.id)).toEqual([mine.id]);
    expect(list.data.some((row) => row.id === theirs.id)).toBe(false);
    expect(list.data.every((row) => row.organization_id === orgA)).toBe(true);

    const crossOrg = await asOrg(orgA, () => catchHttp(() => schemasController.findOne(theirs.id)));
    logPair('GET /v1/report/schemas/{id} (other org id)', { id: theirs.id }, crossOrg);
    expect(crossOrg.status).toBe(HttpStatus.NOT_FOUND);
    expect(crossOrg.name).toBe(NotFoundException.name);

    const own = await asOrg(orgA, () => schemasController.findOne(mine.id));
    expect(own.id).toBe(mine.id);
  });

  it('updates a custom schema with PUT and refuses system schemas for both PUT and DELETE', async () => {
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Rename me',
        category: 'member',
        query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      } as CreateReportSchemaDto),
    );

    const updateRequest: UpdateReportSchemaDto = {
      name: 'Renamed',
      description: 'updated via PUT',
      is_active: true,
    };
    const updated = await asOrg(orgA, () => schemasController.update(created.id, updateRequest));
    logPair(`PUT /v1/report/schemas/${created.id}`, updateRequest, updated);

    expect(updated.name).toBe('Renamed');
    expect(updated.description).toBe('updated via PUT');
    // The tenant boundary is not writable through a body: the row is still org A's.
    expect(updated.organization_id).toBe(orgA);

    // A seeded system row (§6/P6-07's shape) must be immutable through this route.
    const systemRow = await schemaRepository.save({
      organization_id: orgA,
      name: 'System catalog row',
      category: 'member',
      query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      parameters: [],
      is_system: true,
      is_active: true,
    });

    const putSystem = await asOrg(orgA, () =>
      catchHttp(() => schemasController.update(systemRow.id, { name: 'hijacked' })),
    );
    logPair('PUT system schema', { name: 'hijacked' }, putSystem);
    expect(putSystem.status).toBe(HttpStatus.FORBIDDEN);
    expect(putSystem.name).toBe(ForbiddenException.name);

    const deleteSystem = await asOrg(orgA, () =>
      catchHttp(() => schemasController.remove(systemRow.id)),
    );
    logPair('DELETE system schema', { id: systemRow.id }, deleteSystem);
    expect(deleteSystem.status).toBe(HttpStatus.FORBIDDEN);
    expect((await schemaRepository.findOneByOrFail({ id: systemRow.id })).is_active).toBe(true);
  });

  it('DELETE deactivates a custom schema, and the row survives because a job references it', async () => {
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Delete me',
        category: 'member',
        query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      } as CreateReportSchemaDto),
    );

    // Give the schema a job: this is what makes the ON DELETE NO ACTION reference real,
    // so a hard delete would now be a foreign-key violation.
    const job = await asOrg(orgA, () =>
      jobsController.execute(created.id, {}, { setHeader: () => undefined }),
    );
    expect(job.report_schema_id).toBe(created.id);

    const deleted = await asOrg(orgA, () => schemasController.remove(created.id));
    logPair(`DELETE /v1/report/schemas/${created.id}`, { id: created.id }, {
      id: deleted.id,
      is_active: deleted.is_active,
    });

    expect(deleted.is_active).toBe(false);
    expect(await schemaRepository.count({ where: { id: created.id } })).toBe(1);

    const list = await asOrg(orgA, () =>
      schemasController.findAll({ page: 1, limit: 20 } as QueryReportSchemasDto),
    );
    expect(list.data.some((row) => row.id === created.id)).toBe(false);
    // Still reachable by id, which is what makes PUT's `is_active` reversal meaningful.
    expect((await asOrg(orgA, () => schemasController.findOne(created.id))).is_active).toBe(false);
  });

  it('executes a report through the trigger and polls to a real completed status', async () => {
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Count members',
        category: 'member',
        query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      } as CreateReportSchemaDto),
    );

    const responseHeaders: Record<string, string> = {};
    const trigger = await asOrg(orgA, () =>
      jobsController.execute(created.id, {}, {
        setHeader: (name: string, value: string) => {
          responseHeaders[name] = value;
        },
      }),
    );
    logPair(`POST /v1/report/schemas/${created.id}/execute`, { parameters: {} }, trigger);

    expect(trigger.status).toBe('pending');
    expect(trigger.report_schema_id).toBe(created.id);
    expect(trigger.result_rows).toBeNull(); // nothing has run yet
    expect(responseHeaders['Retry-After']).toBeUndefined(); // only the 429 sets it

    // What the ReportJobWorker actually does on a tick.
    const drained = await reportJobService.runPendingBatch(5);
    console.log(`[report-api evidence] worker drain result=${JSON.stringify(drained)}`);

    const status = await asOrg(orgA, () => jobsController.findOne(trigger.id));
    logPair(`GET /v1/report/jobs/${trigger.id}`, { id: trigger.id }, status);

    expect(status.status).toBe('completed');
    // The query is an ungrouped aggregate, so it returns exactly one row.
    expect(status.result_rows).toBe(1);
    expect(status.result_format).toBe('json');
    expect(status.progress_pct).toBe(100);
    expect(status.error_message).toBeNull();
    expect(status.started_at).not.toBeNull();
    expect(status.completed_at).not.toBeNull();
    // P6-36: no result artefact exists, and the response says so explicitly.
    expect(status.result_s3_key).toBeNull();
    expect(status.result_s3_bucket).toBeNull();
  });

  /**
   * P6-06 over the API surface. The service-level spec proves `create()`/`update()` call
   * the declaration path; these prove the same through the real controller, so a fix that
   * only worked in a unit test's call shape would still fail here.
   */
  it('POST /v1/report/schemas accepts a definition declaring $from/$to/$branchId with no values', async () => {
    const body = {
      name: 'Invoices by status and period',
      category: 'finance',
      query_definition: {
        source: 'Invoice',
        columns: {
          status: 'status',
          total: { fn: 'SUM', column: 'total_amount' },
          count: { fn: 'COUNT', column: '*' },
        },
        filters: [
          { column: 'invoice_date', operator: 'BETWEEN', value: ['$from', '$to'] },
          { column: 'branch_id', operator: '=', value: '$branchId' },
        ],
        group_by: ['status'],
        order_by: [{ column: 'total', direction: 'DESC' }],
      },
      // §3.1 parameter *declarations* — the DTO list is not a value map.
      parameters: [
        { name: 'from', type: 'date' },
        { name: 'to', type: 'date' },
        { name: 'branchId', type: 'uuid' },
      ],
    };

    const created = await asOrg(orgA, () =>
      schemasController.create(body as CreateReportSchemaDto),
    );
    logPair('POST /v1/report/schemas (declared placeholders)', body, created);

    // A plain record, not a 400: this is the defect's exact reproduction.
    expect(created.id).toBeDefined();
    expect(created.organization_id).toBe(orgA);
    expect(created.is_system).toBe(false);
    // Stored unresolved — resolution is §3.1.1's execution-time step.
    expect(created.query_definition).toEqual(body.query_definition);
  });

  it('PUT /v1/report/schemas/{id} accepts the same declared placeholders on update', async () => {
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Update target',
        query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      } as CreateReportSchemaDto),
    );

    const body = {
      query_definition: {
        source: 'AttendanceRecord',
        columns: { rows: { fn: 'COUNT', column: '*' } },
        filters: [
          { column: 'check_in_time', operator: 'BETWEEN', value: ['$from', '$to'] },
          { column: 'branch_id', operator: '=', value: '$branchId' },
        ],
      },
    };

    const updated = await asOrg(orgA, () =>
      schemasController.update(created.id, body as UpdateReportSchemaDto),
    );
    logPair(`PUT /v1/report/schemas/${created.id} (declared placeholders)`, body, updated);

    expect(updated.id).toBe(created.id);
    expect(updated.query_definition).toEqual(body.query_definition);
  });

  it('the newly created placeholder schema still fails at execution until values are supplied', async () => {
    // The other half of the boundary, over HTTP: storing it succeeded, running it
    // without values does not. This is what proves declaration mode moved the rejection
    // later instead of removing it.
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Needs parameters',
        query_definition: {
          source: 'Invoice',
          columns: { rows: { fn: 'COUNT', column: '*' } },
          filters: [{ column: 'invoice_date', operator: 'BETWEEN', value: ['$from', '$to'] }],
        },
      } as CreateReportSchemaDto),
    );

    const trigger = await asOrg(orgA, () =>
      jobsController.execute(created.id, {}, {
        setHeader: () => undefined,
      }),
    );

    const drained = await reportJobService.runPendingBatch(5);
    console.log(`[report-api evidence] drain for unresolved placeholders=${JSON.stringify(drained)}`);

    const status = await asOrg(orgA, () => jobsController.findOne(trigger.id));
    logPair(`GET /v1/report/jobs/${trigger.id} (no parameter values supplied)`, {}, status);

    expect(status.status).toBe('failed');
    expect(status.error_message).toContain('$from');
    expect(status.result_rows).toBeNull();
  });

  it('reports a genuine failed status when a source column is dropped after the schema was saved', async () => {
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Drift-prone',
        category: 'member',
        query_definition: { source: 'Member', columns: { value: 'first_name' } },
      } as CreateReportSchemaDto),
    );
    const trigger = await asOrg(orgA, () =>
      jobsController.execute(created.id, {}, { setHeader: () => undefined }),
    );

    // §10's schema-drift case, produced for real: the column the definition names is
    // dropped after the schema was saved, so the failure comes from the database.
    await ds.query('ALTER TABLE "MEMBERS_MEMBERS" DROP COLUMN "first_name"');
    try {
      const drained = await reportJobService.runPendingBatch(5);
      console.log(`[report-api evidence] worker drain result (drift)=${JSON.stringify(drained)}`);

      const status = await asOrg(orgA, () => jobsController.findOne(trigger.id));
      logPair(`GET /v1/report/jobs/${trigger.id} (schema drift)`, { id: trigger.id }, status);

      expect(status.status).toBe('failed');
      expect(status.result_rows).toBeNull();
      expect(status.error_message).toMatch(/first_name|does not exist/i);
      expect(status.completed_at).not.toBeNull();
    } finally {
      await ds.query('ALTER TABLE "MEMBERS_MEMBERS" ADD COLUMN "first_name" varchar(255)');
      await ds.query(
        `UPDATE "MEMBERS_MEMBERS" SET "first_name" = 'restored' WHERE "organization_id" = $1`,
        [orgA],
      );
    }
  });

  it('refuses to execute a deactivated schema (409) and 404s unknown or cross-org job ids', async () => {
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Deactivated',
        category: 'member',
        query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      } as CreateReportSchemaDto),
    );
    await asOrg(orgA, () => schemasController.remove(created.id));

    const refused = await asOrg(orgA, () =>
      catchHttp(() => jobsController.execute(created.id, {}, { setHeader: () => undefined })),
    );
    logPair(`POST /v1/report/schemas/${created.id}/execute (deactivated)`, {}, refused);
    expect(refused.status).toBe(HttpStatus.CONFLICT);
    expect(refused.name).toBe(ConflictException.name);

    const unknownJob = await asOrg(orgA, () =>
      catchHttp(() => jobsController.findOne(crypto.randomUUID())),
    );
    logPair('GET /v1/report/jobs/{random uuid}', { id: 'random' }, unknownJob);
    expect(unknownJob.status).toBe(HttpStatus.NOT_FOUND);

    // A job id belonging to another organization is a 404, not a 403 that confirms it.
    const otherOrgSchema = await asOrg(orgB, () =>
      schemasController.create({
        name: 'B report',
        category: 'member',
        query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      } as CreateReportSchemaDto),
    );
    const otherJob = await asOrg(orgB, () =>
      jobsController.execute(otherOrgSchema.id, {}, { setHeader: () => undefined }),
    );
    const crossOrgJob = await asOrg(orgA, () => catchHttp(() => jobsController.findOne(otherJob.id)));
    logPair('GET /v1/report/jobs/{other org job}', { id: otherJob.id }, crossOrgJob);
    expect(crossOrgJob.status).toBe(HttpStatus.NOT_FOUND);
    expect(await jobRepository.count({ where: { id: otherJob.id, organization_id: orgB } })).toBe(1);
  });

  it('the queue-depth guard answers 429 with the pending count and sets Retry-After, then accepts again', async () => {
    const created = await asOrg(orgA, () =>
      schemasController.create({
        name: 'Queue guard',
        category: 'member',
        query_definition: { source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } },
      } as CreateReportSchemaDto),
    );

    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    };

    const first = await asOrg(orgA, () => jobsController.execute(created.id, {}, res));
    const second = await asOrg(orgA, () => jobsController.execute(created.id, {}, res));
    console.log(
      `[report-api evidence] queue at cap jobs=${JSON.stringify([first.status, second.status])} redis_pending=${await reportJobService.getPendingCount(orgA)}`,
    );

    const refused = await asOrg(orgA, () =>
      catchHttp(() => jobsController.execute(created.id, {}, res)),
    );
    logPair('POST /v1/report/schemas/{id}/execute (past MAX_PENDING_JOBS)', {}, {
      status: refused.status,
      body: refused.body,
      retryAfterHeader: headers['Retry-After'],
    });

    expect(refused.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = refused.body as {
      code: string;
      detail: { pending: number; max: number };
      retryAfterSeconds: number;
    };
    expect(body.code).toBe('QUEUE_DEPTH_EXCEEDED');
    expect(body.detail.pending).toBe(2);
    expect(body.detail.max).toBe(2);
    // The header is set by the shipped controller, not by this test.
    expect(headers['Retry-After']).toBe('15'); // WORKER_INTERVALS.REPORT_JOBS (15s) / 1000
    expect(await jobRepository.count({ where: { organization_id: orgA } })).toBe(2);
    expect(await reportJobService.getPendingCount(orgA)).toBe(2);

    // Draining one job frees a slot, and the next trigger is accepted.
    await reportJobService.runPendingBatch(1);
    const accepted = await asOrg(orgA, () => jobsController.execute(created.id, {}, res));
    expect(accepted.status).toBe('pending');
    console.log(
      `[report-api evidence] queue after one completion redis_pending=${await reportJobService.getPendingCount(orgA)} accepted_job=${accepted.id}`,
    );
  });

  it('every route is guarded by the seeded report permissions, which exist in the database', async () => {
    const permissionFor = (handler: string, controller: object): RequiredPermission[] | undefined =>
      reflector.get<RequiredPermission[]>(
        PERMISSIONS_KEY,
        controller[handler as keyof typeof controller] as Function,
      );

    const declared = {
      'schemas.findAll': permissionFor('findAll', schemasController),
      'schemas.findOne': permissionFor('findOne', schemasController),
      'schemas.create': permissionFor('create', schemasController),
      'schemas.update': permissionFor('update', schemasController),
      'schemas.remove': permissionFor('remove', schemasController),
      'jobs.execute': permissionFor('execute', jobsController),
      'jobs.findOne': permissionFor('findOne', jobsController),
    };
    console.log(`[report-api evidence] route permissions=${JSON.stringify(declared)}`);

    expect(declared['schemas.findAll']).toEqual([{ resource: 'report', action: 'view' }]);
    expect(declared['schemas.findOne']).toEqual([{ resource: 'report', action: 'view' }]);
    expect(declared['schemas.create']).toEqual([{ resource: 'report', action: 'create' }]);
    expect(declared['schemas.update']).toEqual([{ resource: 'report', action: 'edit' }]);
    expect(declared['schemas.remove']).toEqual([{ resource: 'report', action: 'delete' }]);
    // §9.1 defines REPORT_VIEW as "View report catalog + run reports".
    expect(declared['jobs.execute']).toEqual([{ resource: 'report', action: 'view' }]);
    expect(declared['jobs.findOne']).toEqual([{ resource: 'report', action: 'view' }]);

    // And the guard would not 403: the rows the routes name are really provisioned.
    const permissions = await ds.getRepository(IdentityPermission).find({
      where: { resource: 'report' },
      order: { action: 'ASC' },
    });
    console.log(
      `[report-api evidence] provisioned report permissions=${JSON.stringify(
        permissions.map((p) => `${p.resource}:${p.action}`),
      )}`,
    );
    expect(permissions.map((p) => `${p.resource}:${p.action}`)).toEqual([
      'report:create',
      'report:delete',
      'report:edit',
      'report:view',
    ]);
  });

});
