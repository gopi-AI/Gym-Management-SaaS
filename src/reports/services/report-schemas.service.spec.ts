import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppDataSource } from '../../data-source';
import { ReportSchema } from '../entities/report-schema.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { ReportQueryValidator } from './report-query-validator.service';
import { ReportSchemasService } from './report-schemas.service';
import type { CreateReportSchemaDto, UpdateReportSchemaDto } from '../dto/report-schema.dto';
import type { QueryDefinition } from '../types/query-definition';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

/** Definitions arrive as **data** (a jsonb column), so they are built as `unknown`. */
const def = (value: unknown): QueryDefinition => value as QueryDefinition;

/**
 * The §4.1 create/update surface of `ReportSchemasService`, and the P6-06 boundary it
 * defines: **declaration** accepts `$name` placeholders, **execution** resolves them.
 *
 * The repository and the tenant context are stubs, but `ReportQueryValidator` is the
 * real service running against the real `AppDataSource` metadata. That matters because
 * the behaviour under test *is* the validator's declaration path: a stubbed validator
 * would only prove that this service calls the method the test itself named. With real
 * metadata, the allowlist rules (unknown source, unknown column, bad aggregate, bad
 * bucket unit, `organization_id` in a definition, literal type mismatch) are the ones
 * that actually ship, and the regression test proves the real `$from`/`$to` case now
 * passes creation without any runtime values.
 */
describe('ReportSchemasService (declaration-time validation, P6-06)', () => {
  let service: ReportSchemasService;
  let schemaRepository: {
    save: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
  };
  let tenantContext: Record<string, jest.Mock>;

  /** The row `findOne` returns; reconciled in each test that needs a custom schema. */
  let storedSchema: ReportSchema;

  beforeEach(async () => {
    storedSchema = {
      id: 'schema-1',
      organization_id: ORG,
      name: 'Sessions by period',
      description: null,
      category: 'custom',
      query_definition: def({ source: 'Member', columns: { id: 'id' } }),
      parameters: [],
      is_system: false,
      is_active: true,
      created_by: null,
    } as unknown as ReportSchema;

    schemaRepository = {
      save: jest.fn(async (entity: unknown) => ({ id: 'schema-1', ...(entity as object) })),
      // Honours the `where` clause the service builds. Tenant scoping is the property
      // under test elsewhere, so stubbing it away here would make a cross-tenant test
      // assert nothing: this returns a row for its own organization only.
      findOne: jest.fn(async ({ where }: { where: { id: string; organization_id: string } }) =>
        where.id === storedSchema.id && where.organization_id === storedSchema.organization_id
          ? storedSchema
          : null,
      ),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    tenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(ORG),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(null),
      requireOrganizationAccess: jest.fn(),
      getCurrentUserId: jest.fn().mockResolvedValue(null),
    };

    // The validator's documented precondition: metadata must be built before use.
    // `buildMetadatas()` opens no connection, which is why this spec needs no database
    // and writes nothing — but it does require it to have been called.
    const ds = AppDataSource;
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportSchemasService,
        { provide: getRepositoryToken(ReportSchema), useValue: schemaRepository },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: ReportQueryValidator, useValue: new ReportQueryValidator(ds) },
      ],
    }).compile();

    service = module.get<ReportSchemasService>(ReportSchemasService);
  });

  /** Asserts the service rejected with a Phase A code, mapped to a 400 by the boundary. */
  const expectCode = async (run: () => Promise<unknown>, code: string): Promise<void> => {
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code });
  };

  /**
   * The shape P6-06 is about: `BETWEEN ['$from', '$to']` plus a branch filter on
   * `$branchId`. Before the fix this was uncreatable — creation validated the
   * placeholders as though execution-time values had already been supplied.
   */
  const placeholderDefinition = def({
    source: 'Invoice',
    columns: { status: 'status', total: { fn: 'SUM', column: 'total_amount' } },
    filters: [
      { column: 'invoice_date', operator: 'BETWEEN', value: ['$from', '$to'] },
      { column: 'branch_id', operator: '=', value: '$branchId' },
    ],
    group_by: ['status'],
    order_by: [{ column: 'total', direction: 'DESC' }],
  });

  describe('create() accepts declared $ placeholders (P6-06)', () => {
    it('creates a schema whose definition declares $from/$to/$branchId with no runtime values', async () => {
      const created = await service.create({
        name: 'Sessions by period',
        category: 'finance',
        query_definition: placeholderDefinition,
        // §3.1's parameter *declarations* — never runtime values. The DTO's list is
        // metadata about which parameters the report accepts; it is not a value map.
        parameters: [],
      } as CreateReportSchemaDto);

      expect(created).toBeDefined();
      expect(schemaRepository.save).toHaveBeenCalledTimes(1);

      const saved = schemaRepository.save.mock.calls[0][0] as {
        organization_id: string;
        is_system: boolean;
        is_active: boolean;
        query_definition: QueryDefinition;
      };
      expect(saved.organization_id).toBe(ORG);
      expect(saved.is_system).toBe(false);
      expect(saved.is_active).toBe(true);
      // Stored verbatim: a declaration is not rewritten or substituted at creation —
      // `$from` stays `$from` until a report run resolves it.
      expect(saved.query_definition).toEqual(placeholderDefinition);
    });

    it('creates a schema whose definition omits the parameters list entirely', async () => {
      // The only DTO difference is the absent `parameters` field, which is what an API
      // caller sending just a `query_definition` does.
      await expect(
        service.create({
          name: 'No declaration list',
          query_definition: placeholderDefinition,
        } as CreateReportSchemaDto),
      ).resolves.toBeDefined();
    });

    it('accepts a $placeholder inside an IN list and as a single value', async () => {
      await expect(
        service.create({
          name: 'Placeholder shapes',
          query_definition: def({
            source: 'Invoice',
            columns: { rows: { fn: 'COUNT', column: '*' } },
            filters: [
              { column: 'status', operator: 'IN', value: ['$status1', 'paid'] },
              { column: 'branch_id', operator: '=', value: '$branchId' },
            ],
          }),
        } as CreateReportSchemaDto),
      ).resolves.toBeDefined();
    });
  });

  describe('create() still rejects every other invalid definition (P6-06)', () => {
    it('still enforces the allowlist, scoping and shape rules', async () => {
      const cases: { name: string; definition: unknown; code: string }[] = [
        {
          name: 'unknown source',
          definition: { source: 'Nope', columns: { id: 'id' } },
          code: 'UNKNOWN_SOURCE',
        },
        {
          name: 'unknown column in a filter',
          definition: {
            source: 'Member',
            columns: { id: 'id' },
            filters: [{ column: 'nope', operator: '=', value: 'x' }],
          },
          code: 'UNKNOWN_COLUMN',
        },
        {
          name: 'a definition supplying its own tenant filter',
          definition: {
            source: 'Member',
            columns: { id: 'id' },
            filters: [{ column: 'organization_id', operator: '=', value: ORG }],
          },
          code: 'SCOPING_COLUMN_IN_DEFINITION',
        },
        {
          name: 'a function outside the aggregate set',
          definition: { source: 'Member', columns: { t: { fn: 'MEDIAN', column: 'id' } } },
          code: 'INVALID_AGGREGATE',
        },
        {
          name: 'no columns selected',
          definition: { source: 'Member', columns: {} },
          code: 'EMPTY_COLUMNS',
        },
      ];

      for (const testCase of cases) {
        await expectCode(
          () =>
            service.create({
              name: testCase.name,
              query_definition: def(testCase.definition),
            } as CreateReportSchemaDto),
          testCase.code,
        );
      }
    });

    it('still type-checks a LITERAL sitting beside a declared placeholder', async () => {
      // The narrowness of the declaration exemption, asserted directly: only the
      // `$name` entry is deferred. The literal `'not-a-date'` in the same BETWEEN is
      // still rejected, so deferral did not become a blanket exempt-all-filters rule.
      await expectCode(
        () =>
          service.create({
            name: 'Half-declared',
            query_definition: def({
              source: 'Invoice',
              columns: { rows: { fn: 'COUNT', column: '*' } },
              filters: [
                { column: 'invoice_date', operator: 'BETWEEN', value: ['$from', 'not-a-date'] },
              ],
            }),
          } as CreateReportSchemaDto),
        'FILTER_VALUE_TYPE_MISMATCH',
      );
    });

    it('still enforces per-operator arity and shape when placeholders are involved', async () => {
      // BETWEEN needs exactly two entries and IN needs an array; declaring placeholders
      // does not relax either rule.
      await expectCode(
        () =>
          service.create({
            name: 'Short BETWEEN',
            query_definition: def({
              source: 'Invoice',
              columns: { rows: { fn: 'COUNT', column: '*' } },
              filters: [{ column: 'invoice_date', operator: 'BETWEEN', value: ['$from'] }],
            }),
          } as CreateReportSchemaDto),
        'FILTER_VALUE_TYPE_MISMATCH',
      );

      await expectCode(
        () =>
          service.create({
            name: 'Scalar IN',
            query_definition: def({
              source: 'Invoice',
              columns: { rows: { fn: 'COUNT', column: '*' } },
              filters: [{ column: 'status', operator: 'IN', value: '$status' }],
            }),
          } as CreateReportSchemaDto),
        'FILTER_VALUE_TYPE_MISMATCH',
      );
    });

    it('still requires an authorized organization and writes nothing without one', async () => {
      // No current org and no requested org: the P6-06 change must not have opened a
      // path that reaches validation (or a write) without an authorized tenant.
      tenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      tenantContext.getRequestedOrganizationId.mockResolvedValue(null);

      await expect(
        service.create({
          name: 'No tenant',
          query_definition: placeholderDefinition,
        } as CreateReportSchemaDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(schemaRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('update() accepts declared $ placeholders (P6-06)', () => {
    it('updates an existing custom schema to a definition declaring $from/$to/$branchId', async () => {
      const updated = await service.update('schema-1', {
        query_definition: placeholderDefinition,
      } as UpdateReportSchemaDto);

      expect(updated).toBeDefined();
      const saved = schemaRepository.save.mock.calls[0][0] as {
        query_definition: QueryDefinition;
      };
      expect(saved.query_definition).toEqual(placeholderDefinition);
    });

    it('re-validates an updated definition and still rejects a bad one', async () => {
      // `update()` must not have become a way to store a definition that `create()`
      // would refuse: the same declaration-mode validation runs here.
      await expectCode(
        () =>
          service.update('schema-1', {
            query_definition: def({ source: 'Nope', columns: { id: 'id' } }),
          } as UpdateReportSchemaDto),
        'UNKNOWN_SOURCE',
      );
      expect(schemaRepository.save).not.toHaveBeenCalled();
    });

    it('still refuses a schema belonging to another organization (404, not 403)', async () => {
      // Tenant scoping is preserved: `findOne` filters on the authorized organization,
      // so another tenant's id is indistinguishable from a nonexistent one — a 404
      // rather than a 403 that would confirm the row exists. The declaration-mode
      // change must not have bypassed that lookup on the way to validation.
      storedSchema.organization_id = OTHER_ORG;

      await expect(
        service.update('schema-1', {
          query_definition: placeholderDefinition,
        } as UpdateReportSchemaDto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(schemaRepository.save).not.toHaveBeenCalled();
    });

    it('still refuses to modify a system schema', async () => {
      storedSchema.is_system = true;
      await expect(
        service.update('schema-1', {
          query_definition: placeholderDefinition,
        } as UpdateReportSchemaDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(schemaRepository.save).not.toHaveBeenCalled();
    });
  });
});



