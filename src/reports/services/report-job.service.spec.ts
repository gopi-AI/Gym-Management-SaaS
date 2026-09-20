import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { createCache, type Cache } from 'cache-manager';
import { AppDataSource } from '../../data-source';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Member } from '../../members/entities/member.entity';
import { ReportJob } from '../entities/report-job.entity';
import { ReportSchema } from '../entities/report-schema.entity';
import { ReportJobError } from '../errors/report-job.errors';
import { ReportQueryBuilder } from './report-query-builder.service';
import { ReportQueryValidator } from './report-query-validator.service';
import { ReportJobService } from './report-job.service';
import type { QueryDefinition } from '../types/query-definition';

jest.setTimeout(120_000);

const definition = (value: unknown): QueryDefinition => value as QueryDefinition;
const ENABLED = Boolean(process.env.DB_HOST);
const describeDb = ENABLED ? describe : describe.skip;

/**
 * Phase B integration proof. This suite deliberately uses the configured scratch
 * PostgreSQL and Redis instances rather than mocks: the state-machine, row lock,
 * schema drift, and queue counter all need to be observed at their real boundaries.
 */
describeDb('ReportJobService against PostgreSQL and Redis (Phase B)', () => {
  let service: ReportJobService;
  let cache: Cache;
  let store: Awaited<ReturnType<typeof redisStore>>;
  let jobs: ReturnType<typeof AppDataSource.getRepository<ReportJob>>;
  let schemas: ReturnType<typeof AppDataSource.getRepository<ReportSchema>>;
  const organizationId = crypto.randomUUID();
  const branchId = crypto.randomUUID();

  const count = () => service.getPendingCount(organizationId);
  const print = async (label: string, ids: string[] = []) => {
    const rows = await jobs.find({ where: { organization_id: organizationId }, order: { created_at: 'ASC' } });
    const selected = ids.length ? rows.filter((row) => ids.includes(row.id)) : rows;
    console.log(`[report-job evidence] ${label} rows=${JSON.stringify(selected)} redis_pending=${await count()}`);
  };

  const memberDefinition = (column: string): QueryDefinition =>
    definition({ source: 'Member', columns: { value: column } });

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    jobs = AppDataSource.getRepository(ReportJob);
    schemas = AppDataSource.getRepository(ReportSchema);

    await AppDataSource.getRepository(Organization).save({
      id: organizationId, name: `phase-b-${organizationId}`, timezone: 'UTC', locale: 'en-US', currency: 'USD',
    });
    await AppDataSource.getRepository(Branch).save({
      id: branchId, organization_id: organizationId, name: 'Phase B', address: 'scratch', phone: '0',
    });
    await AppDataSource.getRepository(Member).save({
      id: crypto.randomUUID(), organization_id: organizationId, branch_id: branchId,
      global_uuid: crypto.randomUUID(), local_id: 1, first_name: 'Phase', last_name: 'B',
    });

    store = await redisStore({ url: 'redis://127.0.0.1:6379', database: 0 });
    cache = createCache(store);
    service = new ReportJobService(
      jobs,
      schemas,
      AppDataSource,
      new ReportQueryValidator(AppDataSource),
      new ReportQueryBuilder(AppDataSource),
      cache,
      { get: (key: string) => (key === 'MAX_PENDING_JOBS' ? '2' : undefined) } as ConfigService,
    );
    await cache.del(`reports:jobs:pending:${organizationId}`);
  });

  afterEach(async () => {
    await cache.set(`reports:jobs:pending:${organizationId}`, 0);
    await jobs.delete({ organization_id: organizationId });
    await schemas.delete({ organization_id: organizationId });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Member).delete({ organization_id: organizationId });
    await AppDataSource.getRepository(Branch).delete({ organization_id: organizationId });
    await AppDataSource.getRepository(Organization).delete({ id: organizationId });
    await cache.del(`reports:jobs:pending:${organizationId}`);
    await store.client.quit();
    await AppDataSource.destroy();
  });

  it('creates schema-referenced and ad-hoc jobs, persisting the latter as a schema row', async () => {
    const savedSchema = await schemas.save({
      organization_id: organizationId, name: 'Saved member report', category: 'member',
      query_definition: memberDefinition('first_name'), parameters: [], is_system: false, is_active: true,
    });
    const savedJob = await service.createJob({ organizationId, schemaId: savedSchema.id });
    const adHocJob = await service.createJob({
      organizationId, definition: definition({ source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } }),
      name: 'Ad-hoc member count',
    });
    const adHocSchema = await schemas.findOneByOrFail({ id: adHocJob.report_schema_id! });

    expect(savedJob.report_schema_id).toBe(savedSchema.id);
    expect(adHocSchema.query_definition).toEqual({ source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } });
    expect(await count()).toBe(2);
    console.log(`[report-job evidence] creation saved_job=${JSON.stringify(savedJob)} ad_hoc_job=${JSON.stringify(adHocJob)} ad_hoc_schema=${JSON.stringify(adHocSchema)} redis_pending=${await count()}`);
  });

  it('runs pending → running → completed with real rows and counter values', async () => {
    const schema = await schemas.save({ organization_id: organizationId, name: 'Count', category: 'member', query_definition: memberDefinition('first_name'), parameters: [] });
    const job = await service.createJob({ organizationId, schemaId: schema.id });
    await print('completed transition before run', [job.id]);
    const result = await service.runPendingBatch(1);
    await print('completed transition after run', [job.id]);
    const row = await jobs.findOneByOrFail({ id: job.id });
    expect(result).toMatchObject({ scanned: 1, completed: 1, failed: 0 });
    expect(row.status).toBe('completed');
    expect(row.result_rows).toBe(1);
    expect(await count()).toBe(0);
  });

  it('runs pending → running → failed on genuine schema drift', async () => {
    const schema = await schemas.save({ organization_id: organizationId, name: 'Drift', category: 'member', query_definition: memberDefinition('first_name'), parameters: [] });
    const job = await service.createJob({ organizationId, schemaId: schema.id });
    await print('failed transition before source-column drop', [job.id]);
    await AppDataSource.query('ALTER TABLE "MEMBERS_MEMBERS" DROP COLUMN "first_name"');
    try {
      const result = await service.runPendingBatch(1);
      await print('failed transition after source-column drop', [job.id]);
      const row = await jobs.findOneByOrFail({ id: job.id });
      expect(result).toMatchObject({ scanned: 1, completed: 0, failed: 1 });
      expect(row.status).toBe('failed');
      expect(row.error_message).toMatch(/first_name|does not exist/i);
      expect(await count()).toBe(0);
    } finally {
      await AppDataSource.query('ALTER TABLE "MEMBERS_MEMBERS" ADD COLUMN "first_name" varchar(255)');
      await AppDataSource.query('UPDATE "MEMBERS_MEMBERS" SET "first_name" = \'restored\' WHERE "organization_id" = $1', [organizationId]);
    }
  });

  it('rejects beyond the Redis cap and accepts again after completion frees a slot', async () => {
    const schema = await schemas.save({ organization_id: organizationId, name: 'Queue', category: 'member', query_definition: definition({ source: 'Member', columns: { total: { fn: 'COUNT', column: '*' } } }), parameters: [] });
    const first = await service.createJob({ organizationId, schemaId: schema.id });
    const second = await service.createJob({ organizationId, schemaId: schema.id });
    console.log(`[report-job evidence] queue at cap first=${JSON.stringify(first)} second=${JSON.stringify(second)} redis_pending=${await count()}`);
    await expect(service.createJob({ organizationId, schemaId: schema.id })).rejects.toMatchObject({ code: 'QUEUE_DEPTH_EXCEEDED' } satisfies Partial<ReportJobError>);
    expect(await count()).toBe(2);
    await service.runPendingBatch(1);
    console.log(`[report-job evidence] queue after one completion redis_pending=${await count()}`);
    const accepted = await service.createJob({ organizationId, schemaId: schema.id });
    console.log(`[report-job evidence] queue accepted after slot freed job=${JSON.stringify(accepted)} redis_pending=${await count()}`);
    expect(await count()).toBe(2);
  });

  it('row-lock claim path prevents a second claim of the same job', async () => {
    const schema = await schemas.save({ organization_id: organizationId, name: 'Lock', category: 'member', query_definition: memberDefinition('first_name'), parameters: [] });
    const job = await service.createJob({ organizationId, schemaId: schema.id });
    const claim = (service as unknown as { claim(id: string): Promise<ReportJob | null> }).claim.bind(service);
    const [first, second] = await Promise.all([claim(job.id), claim(job.id)]);
    const row = await jobs.findOneByOrFail({ id: job.id });
    console.log(`[report-job evidence] claim race first=${JSON.stringify(first)} second=${JSON.stringify(second)} final_row=${JSON.stringify(row)} redis_pending=${await count()}`);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((value) => value === null)).toHaveLength(1);
    expect(row.status).toBe('running');
    await jobs.update(job.id, { status: 'completed', completed_at: new Date() });
    await cache.set(`reports:jobs:pending:${organizationId}`, 0);
  });
});