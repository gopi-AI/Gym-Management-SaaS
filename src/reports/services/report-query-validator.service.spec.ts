import { AppDataSource } from '../../data-source';
import { ReportQueryValidator } from './report-query-validator.service';
import type { QueryDefinition } from '../types/query-definition';

const ORG = '11111111-1111-4111-8111-111111111111';

/**
 * A `QueryDefinition` arrives as **data** — it is the `query_definition` jsonb column of
 * `REPORTS_REPORT_SCHEMAS`, so nothing type-checks it at runtime. These tests build
 * definitions as `unknown` and cast, which is how a bad definition reaches the
 * validator in production.
 */
const def = (value: unknown): QueryDefinition => value as QueryDefinition;

/**
 * Validator tests against the REAL schema, with no database: `buildMetadatas()` builds
 * entity metadata without opening a connection, so the whole allowlist check is
 * testable offline.
 *
 * Using real metadata rather than hand-written entity stubs is the point — a stub would
 * prove only that the validator agrees with the stub. Here it agrees with `Member`,
 * `Invoice`, `AttendanceRecord` and `LoyaltyTransaction` as they actually are.
 */
describe('ReportQueryValidator (real metadata, no database)', () => {
  let validator: ReportQueryValidator;

  beforeAll(async () => {
    const ds = AppDataSource;
    // `buildMetadatas()` is protected on DataSource; an offline data source is exactly
    // the case it exists for. The validator documents that metadata must be built
    // before use rather than reaching for it itself.
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    validator = new ReportQueryValidator(ds);
  });

  const expectCode = async (
    definition: unknown,
    code: string,
    context: { organizationId: string; parameters?: Record<string, unknown> } = {
      organizationId: ORG,
    },
  ): Promise<void> => {
    await expect(validator.validate(def(definition), context)).rejects.toMatchObject({ code });
  };

  describe('valid definitions', () => {
    it('accepts a plain column selection', async () => {
      const result = await validator.validate(
        def({ source: 'Member', columns: { id: 'id', joined: 'created_at' } }),
        { organizationId: ORG },
      );
      expect(result.source.entityName).toBe('Member');
      expect(result.columns).toHaveLength(2);
      expect(result.columns[0].ref).toEqual({
        kind: 'column',
        column: expect.objectContaining({ databaseName: 'id' }),
      });
      expect(result.organizationId).toBe(ORG);
      expect(result.filters).toEqual([]);
    });

    it('accepts aggregates, COUNT(*) and DISTINCT', async () => {
      const result = await validator.validate(
        def({
          source: 'LoyaltyTransaction',
          columns: {
            total: { fn: 'SUM', column: 'points' },
            rows: { fn: 'COUNT', column: '*' },
            accounts: { fn: 'COUNT', column: 'account_id', distinct: true },
          },
        }),
        { organizationId: ORG },
      );
      expect(result.columns.map((c) => (c.ref as { fn: string }).fn)).toEqual([
        'SUM',
        'COUNT',
        'COUNT',
      ]);
      expect((result.columns[2].ref as { distinct: boolean }).distinct).toBe(true);
      expect((result.columns[1].ref as { column: unknown }).column).toBe('*');
    });

    it('accepts a time bucket over a date column', async () => {
      const result = await validator.validate(
        def({
          source: 'Member',
          columns: {
            month: { bucket: 'created_at', unit: 'month' },
            total: { fn: 'COUNT', column: '*' },
          },
          group_by: ['month'],
          order_by: [{ column: 'month', direction: 'ASC' }],
          limit: 12,
        }),
        { organizationId: ORG },
      );
      expect(result.columns[0].ref).toEqual({
        kind: 'bucket',
        unit: 'month',
        column: expect.objectContaining({ databaseName: 'created_at' }),
      });
      // group_by resolved ALIAS-first: "month" is not a source column at all.
      expect(result.groupBy[0].ref).toEqual(result.columns[0].ref);
      expect(result.limit).toBe(12);
    });

    it('falls back to source columns when no alias matches', async () => {
      const result = await validator.validate(
        def({
          source: 'Invoice',
          columns: { status: 'status', total: { fn: 'SUM', column: 'total_amount' } },
          group_by: ['status'],
          order_by: [{ column: 'total', direction: 'DESC' }],
        }),
        { organizationId: ORG },
      );
      expect(result.groupBy[0].ref.kind).toBe('column');
      expect((result.orderBy[0].ref as { fn: string }).fn).toBe('SUM');
    });

    it('accepts every operator in the FilterClause union with a well-typed value', async () => {
      const filters = [
        { column: 'is_active', operator: '=', value: true },
        { column: 'is_active', operator: '!=', value: false },
        { column: 'created_at', operator: '>', value: '2026-01-01T00:00:00.000Z' },
        { column: 'created_at', operator: '>=', value: new Date('2026-01-01T00:00:00.000Z') },
        { column: 'created_at', operator: '<', value: '2026-06-01T00:00:00.000Z' },
        { column: 'created_at', operator: '<=', value: '2026-06-01T00:00:00.000Z' },
        { column: 'created_at', operator: 'BETWEEN', value: ['2026-01-01', '2026-02-01'] },
        { column: 'id', operator: 'IN', value: [ORG] },
        { column: 'id', operator: 'NOT IN', value: [ORG] },
        { column: 'first_name', operator: 'LIKE', value: 'A%' },
        { column: 'first_name', operator: 'IS NOT NULL' },
      ];
      const result = await validator.validate(
        def({ source: 'Member', columns: { id: 'id' }, filters }),
        { organizationId: ORG },
      );
      expect(result.filters.map((f) => f.operator)).toEqual(filters.map((f) => f.operator));
      // Parameter names are positional, so filters never collide.
      expect(result.filters.map((f) => f.parameter)).toEqual(filters.map((_f, i) => `f${i}`));
    });

    it('resolves $placeholders from the supplied parameters', async () => {
      const result = await validator.validate(
        def({
          source: 'AttendanceRecord',
          columns: { rows: { fn: 'COUNT', column: '*' } },
          filters: [{ column: 'check_in_time', operator: 'BETWEEN', value: ['$from', '$to'] }],
        }),
        { organizationId: ORG, parameters: { from: '2026-01-01', to: '2026-02-01' } },
      );
      expect(result.filters[0].value).toEqual(['2026-01-01', '2026-02-01']);
    });

    it('accepts both rewritten §17 examples — the point of the whole resolution', async () => {
      const simpleCount = {
        source: 'Member',
        columns: {
          month: { bucket: 'created_at', unit: 'month' },
          count: { fn: 'COUNT', column: '*' },
        },
        group_by: ['month'],
        order_by: [{ column: 'month', direction: 'ASC' }],
        limit: 12,
      };
      const filteredAggregate = {
        source: 'Invoice',
        columns: {
          status: 'status',
          total: { fn: 'SUM', column: 'total_amount' },
          count: { fn: 'COUNT', column: '*' },
        },
        filters: [{ column: 'created_at', operator: 'BETWEEN', value: ['$from', '$to'] }],
        group_by: ['status'],
        order_by: [{ column: 'total', direction: 'DESC' }],
      };
      await expect(validator.validate(def(simpleCount), { organizationId: ORG })).resolves.toBeDefined();
      await expect(
        validator.validate(def(filteredAggregate), {
          organizationId: ORG,
          parameters: { from: '2026-01-01', to: '2026-02-01' },
        }),
      ).resolves.toBeDefined();
    });
  });

  /**
   * P6-06: declaration-time validation — the mode `POST`/`PUT /v1/report/schemas` uses.
   *
   * `validateDeclaration()` is the **same pipeline** as `validate()` except that a `$name`
   * filter value is accepted unresolved instead of being resolved from `parameters`:
   * §3.1.1 puts that resolution at execution time, and a schema row is stored before any
   * report has run. These tests pin both halves — what declaration mode accepts, and that
   * every other rule is enforced identically.
   */
  describe('declaration mode (P6-06) — the definitions §4.1 stores', () => {
    it('accepts $from/$to/$branchId with no parameter values, and returns nothing buildable', async () => {
      const definition = def({
        source: 'Invoice',
        columns: { status: 'status', total: { fn: 'SUM', column: 'total_amount' } },
        filters: [
          { column: 'invoice_date', operator: 'BETWEEN', value: ['$from', '$to'] },
          { column: 'branch_id', operator: '=', value: '$branchId' },
        ],
        group_by: ['status'],
        order_by: [{ column: 'total', direction: 'DESC' }],
      });

      // The defect itself: this rejected with MISSING_FILTER_VALUE before the fix.
      // `undefined` rather than a ValidatedQuery is deliberate — a declaration holds
      // unresolved placeholders, so it is not something the builder may be handed.
      await expect(
        validator.validateDeclaration(definition, { organizationId: ORG }),
      ).resolves.toBeUndefined();
    });

    it('accepts every $-placeholder position: scalar, BETWEEN pair, IN list and LIKE', async () => {
      const filters = [
        { column: 'created_at', operator: '>', value: '$from' },
        { column: 'created_at', operator: 'BETWEEN', value: ['$from', '$to'] },
        { column: 'id', operator: 'IN', value: ['$a', '$b'] },
        { column: 'first_name', operator: 'LIKE', value: '$pattern' },
      ];
      await expect(
        validator.validateDeclaration(def({ source: 'Member', columns: { id: 'id' }, filters }), {
          organizationId: ORG,
        }),
      ).resolves.toBeUndefined();
    });

    it('still enforces the allowlist, the operator set, scoping and per-operator shape', async () => {
      const cases: { definition: unknown; code: string }[] = [
        { definition: { source: 'Nope', columns: { id: 'id' } }, code: 'UNKNOWN_SOURCE' },
        {
          definition: {
            source: 'Member',
            columns: { id: 'id' },
            filters: [{ column: 'nope', operator: '=', value: '$x' }],
          },
          code: 'UNKNOWN_COLUMN',
        },
        {
          definition: {
            source: 'Member',
            columns: { id: 'id' },
            filters: [{ column: 'organization_id', operator: '=', value: '$org' }],
          },
          code: 'SCOPING_COLUMN_IN_DEFINITION',
        },
        {
          definition: {
            source: 'Member',
            columns: { id: 'id' },
            filters: [{ column: 'id', operator: 'MATCHES', value: '$x' }],
          },
          code: 'INVALID_OPERATOR',
        },
        {
          definition: {
            source: 'Member',
            columns: { id: 'id' },
            filters: [{ column: 'created_at', operator: 'BETWEEN', value: ['$from'] }],
          },
          code: 'FILTER_VALUE_TYPE_MISMATCH',
        },
        {
          definition: {
            source: 'Member',
            columns: { id: 'id' },
            filters: [{ column: 'created_at', operator: '>', value: 'not-a-date' }],
          },
          code: 'FILTER_VALUE_TYPE_MISMATCH',
        },
        {
          definition: { source: 'Member', columns: { id: 'id' }, limit: 0 },
          code: 'INVALID_LIMIT',
        },
        { definition: { source: 'Member', columns: {} }, code: 'EMPTY_COLUMNS' },
      ];

      for (const testCase of cases) {
        await expect(
          validator.validateDeclaration(def(testCase.definition), { organizationId: ORG }),
        ).rejects.toMatchObject({ code: testCase.code });
      }
    });

    it('still requires an organizationId — declaration mode is not an unscoped path', async () => {
      // A definition author cannot fix a missing tenant context, so this must stay a plain
      // Error rather than becoming a validation code — and declaring placeholders must not
      // have opened a route to validation without an authorized organization.
      const error = await validator
        .validateDeclaration(def({ source: 'Member', columns: { id: 'id' } }), {
          organizationId: '',
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as { name: string }).name).toBe('Error');
      expect(error).not.toMatchObject({ code: expect.anything() });
    });

    it('does NOT relax execution: the same definition still fails resolution, then resolves', async () => {
      // The boundary asserted in one place. The definition creation now accepts is still
      // rejected by `validate()` until real values arrive — which is what stops
      // declaration mode from becoming a way to ship a report that binds the literal
      // string "$from" as its value.
      const definition = def({
        source: 'Invoice',
        columns: { rows: { fn: 'COUNT', column: '*' } },
        filters: [{ column: 'invoice_date', operator: 'BETWEEN', value: ['$from', '$to'] }],
      });

      await expect(
        validator.validateDeclaration(definition, { organizationId: ORG }),
      ).resolves.toBeUndefined();

      await expect(
        validator.validate(definition, { organizationId: ORG }),
      ).rejects.toMatchObject({ code: 'MISSING_FILTER_VALUE' });

      // …and resolves once values are supplied, which is §3.1.1's contract.
      const resolved = await validator.validate(definition, {
        organizationId: ORG,
        parameters: { from: '2026-01-01', to: '2026-02-01' },
      });
      expect(resolved.filters[0].value).toEqual(['2026-01-01', '2026-02-01']);
    });
  });

  describe('failure modes — each is a bad request, not an internal error', () => {
    it('UNKNOWN_SOURCE, naming the near-miss when only the casing is wrong', async () => {
      await expectCode({ source: 'Nope', columns: { id: 'id' } }, 'UNKNOWN_SOURCE');
      // The §1.2 failure reproduced: `PtSession` is not an entity, `PTSession` is.
      await expect(
        validator.validate(def({ source: 'PtSession', columns: { id: 'id' } }), {
          organizationId: ORG,
        }),
      ).rejects.toMatchObject({ code: 'UNKNOWN_SOURCE', detail: { didYouMean: 'PTSession' } });
    });

    it('SOURCE_NOT_TENANT_SCOPED for an entity with no organization_id', async () => {
      // MemberProfile is a real member-domain entity with no organization_id, so it
      // can never be scoped — and so can never be a report source.
      await expectCode(
        { source: 'MemberProfile', columns: { avatar: 'avatar_url' } },
        'SOURCE_NOT_TENANT_SCOPED',
      );
    });

    it('UNKNOWN_COLUMN / UNKNOWN_OUTPUT_ALIAS for columns the entity does not have', async () => {
      await expectCode({ source: 'Member', columns: { nope: 'not_a_column' } }, 'UNKNOWN_COLUMN');
      await expectCode(
        {
          source: 'Member',
          columns: { id: 'id' },
          filters: [{ column: 'ghost', operator: '=', value: 1 }],
        },
        'UNKNOWN_COLUMN',
      );
      await expectCode(
        { source: 'Member', columns: { id: 'id' }, group_by: ['ghost'] },
        'UNKNOWN_OUTPUT_ALIAS',
      );
    });

    it('INVALID_AGGREGATE for a function outside the set, and for FUNC(*) misuse', async () => {
      await expectCode(
        { source: 'Member', columns: { x: { fn: 'MEDIAN', column: 'id' } } },
        'INVALID_AGGREGATE',
      );
      await expectCode(
        { source: 'Member', columns: { x: { fn: 'SUM', column: '*' } } },
        'INVALID_AGGREGATE',
      );
    });

    it('INVALID_BUCKET_UNIT for a unit outside the closed set', async () => {
      await expectCode(
        { source: 'Member', columns: { x: { bucket: 'created_at', unit: 'fortnight' } } },
        'INVALID_BUCKET_UNIT',
      );
    });

    it('INVALID_OPERATOR for an operator outside the union', async () => {
      await expectCode(
        {
          source: 'Member',
          columns: { id: 'id' },
          filters: [{ column: 'id', operator: 'MATCHES', value: 'x' }],
        },
        'INVALID_OPERATOR',
      );
    });

    it('FILTER_VALUE_TYPE_MISMATCH for wrong shapes and wrong types', async () => {
      const cases = [
        // shape/operator mismatches
        { column: 'created_at', operator: 'BETWEEN', value: '2026-01-01' },
        { column: 'created_at', operator: 'BETWEEN', value: ['2026-01-01'] },
        { column: 'id', operator: 'IN', value: [] },
        { column: 'id', operator: '=', value: [ORG] },
        { column: 'first_name', operator: 'IS NULL', value: 'x' },
        // value/column-type mismatches
        { column: 'created_at', operator: '=', value: 'not-a-date' },
        { column: 'is_active', operator: '=', value: 'yes' },
        { column: 'id', operator: '=', value: 'not-a-uuid' },
        { column: 'first_name', operator: '=', value: 42 },
      ];
      for (const filter of cases) {
        await expectCode(
          { source: 'Member', columns: { id: 'id' }, filters: [filter] },
          'FILTER_VALUE_TYPE_MISMATCH',
        );
      }
    });

    it('MISSING_FILTER_VALUE for an unresolved placeholder or an absent value', async () => {
      await expectCode(
        {
          source: 'Member',
          columns: { id: 'id' },
          filters: [{ column: 'created_at', operator: '>', value: '$from' }],
        },
        'MISSING_FILTER_VALUE',
      );
      await expectCode(
        { source: 'Member', columns: { id: 'id' }, filters: [{ column: 'id', operator: '=' }] },
        'MISSING_FILTER_VALUE',
      );
    });

    it('SCOPING_COLUMN_IN_DEFINITION — a definition cannot supply its own tenant filter', async () => {
      await expectCode(
        {
          source: 'Member',
          columns: { id: 'id' },
          filters: [{ column: 'organization_id', operator: '=', value: ORG }],
        },
        'SCOPING_COLUMN_IN_DEFINITION',
      );
    });

    it('EMPTY_COLUMNS, INVALID_LIMIT, INVALID_GROUP_TARGET, INVALID_ORDER_DIRECTION', async () => {
      await expectCode({ source: 'Member', columns: {} }, 'EMPTY_COLUMNS');
      await expectCode({ source: 'Member', columns: { id: 'id' }, limit: 0 }, 'INVALID_LIMIT');
      await expectCode({ source: 'Member', columns: { id: 'id' }, limit: 1.5 }, 'INVALID_LIMIT');
      await expectCode(
        {
          source: 'Invoice',
          columns: { total: { fn: 'SUM', column: 'total_amount' } },
          group_by: ['total'],
        },
        'INVALID_GROUP_TARGET',
      );
      await expectCode(
        { source: 'Member', columns: { id: 'id' }, order_by: [{ column: 'id', direction: 'UP' }] },
        'INVALID_ORDER_DIRECTION',
      );
    });

    it('a missing organization is a plain Error, not a validation error', async () => {
      // The distinction the typed errors exist to make: a definition author cannot fix
      // a missing tenant context, so it must not arrive as a "bad request".
      const error = await validator
        .validate(def({ source: 'Member', columns: { id: 'id' } }), { organizationId: '' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as { name: string }).name).toBe('Error');
      expect(error).not.toMatchObject({ code: expect.anything() });
    });
  });
});

