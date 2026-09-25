import { Injectable } from '@nestjs/common';
import { DataSource, EntityMetadata } from 'typeorm';
import { ReportQueryValidationError } from '../errors/report-query.errors';
import type { AggregateFunction, ColumnRef, QueryDefinition, TimeBucketUnit } from '../types/query-definition';
import type {
  DatabaseColumn,
  FilterOperator,
  ResolvedFilter,
  ResolvedRef,
  ValidatedQuery,
} from '../types/validated-query';

/** The closed sets. A value outside one of these is a validation error, never SQL. */
const AGGREGATE_FUNCTIONS: readonly AggregateFunction[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const TIME_BUCKET_UNITS: readonly TimeBucketUnit[] = ['day', 'week', 'month', 'quarter', 'year'];
const FILTER_OPERATORS: readonly FilterOperator[] = [
  '=', '!=', '>', '>=', '<', '<=', 'BETWEEN', 'IN', 'NOT IN', 'LIKE', 'IS NULL', 'IS NOT NULL',
];
const COLUMNS_WITHOUT_A_VALUE: readonly FilterOperator[] = ['IS NULL', 'IS NOT NULL'];
const LIST_OPERATORS: readonly FilterOperator[] = ['BETWEEN', 'IN', 'NOT IN'];

/**
 * Upper bound on `limit`. §6.x rows use small limits (12 for the monthly series); this
 * exists so a definition cannot ask the worker to materialise an entire table. It is
 * an executor guard rather than a plan-specified figure, and is recorded as such.
 */
export const MAX_REPORT_LIMIT = 10_000;

const TYPE_FAMILIES: Record<string, 'number' | 'date' | 'uuid' | 'boolean' | 'text'> = {
  int: 'number', integer: 'number', smallint: 'number', bigint: 'number',
  numeric: 'number', decimal: 'number', float: 'number', double: 'number', real: 'number',
  timestamptz: 'date', timestamp: 'date', date: 'date',
  uuid: 'uuid',
  boolean: 'boolean', bool: 'boolean',
  varchar: 'text', 'character varying': 'text', char: 'text', text: 'text',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which moment in a report definition's life a validation call is for.
 *
 * A `$name` filter value means two different things at the two moments §3.1.1
 * separates, so the mode is what decides whether one has to resolve:
 *
 *   - **`'resolution'`** — execution. The definition is about to be compiled, so every
 *     `$name` must resolve from `parameters` now.
 *   - **`'declaration'`** — `POST`/`PUT /v1/report/schemas` (§4.1). The definition is
 *     only being *stored*; §3.1.1 says a `$name` value is "resolved from the report
 *     parameters at execution time", and no report has run yet.
 *
 * Declaration mode is **opt-in** rather than inferred from a missing `parameters` map:
 * `ValidateContext.parameters` is optional, so inferring would let an execution path
 * that forgot to supply values silently bind each placeholder's own `$name` text as a
 * value (`ReportQueryBuilder` binds whatever `ResolvedFilter.value` holds) instead of
 * failing. A caller has to name the declaration path to get it.
 */
export type ValidationMode = 'resolution' | 'declaration';

export interface ValidateContext {
  /** The authorized organization. The definition never supplies this. */
  organizationId: string;
  /** Values for `$name` placeholders in `FilterClause.value`. */
  parameters?: Record<string, unknown>;
}

/**
 * Context for declaration-time validation (P6-06).
 *
 * Deliberately has **no `parameters`**: at declaration time there are no runtime values
 * to supply, and accepting a map here would reinstate the confusion this path exists to
 * remove — that a still-declared placeholder could be "resolved" before a report runs.
 * The type is the enforcement, not a comment asking callers not to.
 */
export interface ValidateDeclarationContext {
  /** The authorized organization. The definition never supplies this. */
  organizationId: string;
}

/**
 * Validates a `QueryDefinition` against real entity metadata (P6-02/P6-03, Phase A).
 *
 * Everything a definition says is *data* until this service has checked it. The output
 * is a `ValidatedQuery`, which is the only input the builder accepts — so "unvalidated
 * input cannot reach SQL" is enforced by the type system rather than by callers
 * remembering to validate first.
 *
 * Resolution is an **exact** class-name match against the DataSource's metadata, never
 * a substring or case-insensitive comparison. That is the same check that found
 * `PtSession`/`PtEnrollment` failing to resolve while `PTSession`/`PTEnrollment`
 * resolved (§1.2, P6-31); a substring match would have accepted the broken spelling.
 */
@Injectable()
export class ReportQueryValidator {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The DataSource's built entity metadata.
   *
   * `buildMetadatas()` is `protected` on `DataSource`, so this service cannot build
   * it itself — it requires metadata to exist, which it does in a booted application.
   * A test can build metadata with no connection at all; see the validator spec.
   *
   * Throwing a plain `Error` here is deliberate: missing metadata is a wiring fault in
   * the caller's environment, not something a definition author can fix.
   */
  private metadata(): readonly EntityMetadata[] {
    const metadatas = this.dataSource.entityMetadatas;
    if (metadatas.length === 0) {
      throw new Error(
        'ReportQueryValidator requires DataSource metadata to be built before use ' +
          '(the DataSource must be initialised, or buildMetadatas() called in test setup).',
      );
    }
    return metadatas;
  }

  private async resolveSource(definition: QueryDefinition): Promise<{
    entityName: string;
    tableName: string;
    columns: Map<string, DatabaseColumn>;
  }> {
    const source = definition?.source;
    if (typeof source !== 'string' || source.length === 0) {
      throw new ReportQueryValidationError('UNKNOWN_SOURCE', 'Definition has no source entity.', {
        source,
      });
    }

    const metadatas = this.metadata();
    const metadata = metadatas.find((m) => m.targetName === source);

    if (!metadata) {
      // Offer the near-miss when there is one: casing is exactly how the §1.2 entity
      // names went wrong, so `UNKNOWN_SOURCE` is far more useful when it can say
      // "did you mean PTSession".
      const nearMiss = metadatas.find((m) => m.targetName.toLowerCase() === source.toLowerCase());
      throw new ReportQueryValidationError(
        'UNKNOWN_SOURCE',
        nearMiss
          ? `Source "${source}" does not resolve to an entity. Did you mean "${nearMiss.targetName}"?`
          : `Source "${source}" does not resolve to an entity.`,
        { source, ...(nearMiss ? { didYouMean: nearMiss.targetName } : {}) },
      );
    }

    const columns = new Map<string, DatabaseColumn>();
    for (const column of metadata.columns) {
      const resolved: DatabaseColumn = {
        propertyName: column.propertyName,
        databaseName: column.databaseName,
        type: column.type as string,
        isNullable: column.isNullable,
      };
      // Indexed under both names: a definition may legitimately write `created_at`
      // (the column) or `createdAt` (the property).
      columns.set(column.databaseName, resolved);
      columns.set(column.propertyName, resolved);
    }

    // The tenant filter is appended unconditionally, so an entity without the column
    // cannot be a report source at all. This is the P6-25 lesson made mechanical:
    // LOYALTY_TRANSACTIONS had to gain organization_id before a LoyaltyTransaction
    // row could be scoped, and a source that cannot be scoped must fail here rather
    // than run unscoped.
    if (!columns.has('organization_id')) {
      throw new ReportQueryValidationError(
        'SOURCE_NOT_TENANT_SCOPED',
        `Source "${metadata.targetName}" has no organization_id column, so it cannot be tenant-scoped.`,
        { source: metadata.targetName, table: metadata.tableName },
      );
    }

    return { entityName: metadata.targetName, tableName: metadata.tableName, columns };
  }

  private resolveColumn(
    columns: Map<string, DatabaseColumn>,
    name: unknown,
    entityName: string,
  ): DatabaseColumn {
    if (typeof name !== 'string' || name.length === 0) {
      throw new ReportQueryValidationError('UNKNOWN_COLUMN', 'Expected a column name.', {
        column: name,
        source: entityName,
      });
    }
    const column = columns.get(name);
    if (!column) {
      throw new ReportQueryValidationError(
        'UNKNOWN_COLUMN',
        `Column "${name}" does not exist on ${entityName}.`,
        { column: name, source: entityName },
      );
    }
    return column;
  }

  /** Turns one `ColumnRef` into a resolved ref, or explains why it cannot. */
  private resolveRef(
    columns: Map<string, DatabaseColumn>,
    alias: string,
    ref: ColumnRef,
    entityName: string,
  ): ResolvedRef {
    if (typeof ref === 'string') {
      return { kind: 'column', column: this.resolveColumn(columns, ref, entityName) };
    }
    if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
      throw new ReportQueryValidationError(
        'UNKNOWN_COLUMN',
        `Column "${alias}" must be a column name, an aggregate, or a bucket.`,
        { alias, value: ref },
      );
    }

    if ('bucket' in ref) {
      const unit = (ref as { unit?: unknown }).unit;
      if (typeof unit !== 'string' || !TIME_BUCKET_UNITS.includes(unit as TimeBucketUnit)) {
        throw new ReportQueryValidationError(
          'INVALID_BUCKET_UNIT',
          `Bucket unit "${String(unit)}" is not one of: ${TIME_BUCKET_UNITS.join(', ')}.`,
          { alias, unit, allowed: TIME_BUCKET_UNITS },
        );
      }
      return {
        kind: 'bucket',
        column: this.resolveColumn(columns, (ref as { bucket: unknown }).bucket, entityName),
        unit: unit as TimeBucketUnit,
      };
    }

    const fn = (ref as { fn?: unknown }).fn;
    if (typeof fn !== 'string' || !AGGREGATE_FUNCTIONS.includes(fn as AggregateFunction)) {
      throw new ReportQueryValidationError(
        'INVALID_AGGREGATE',
        `Aggregate "${String(fn)}" is not one of: ${AGGREGATE_FUNCTIONS.join(', ')}.`,
        { alias, fn, allowed: AGGREGATE_FUNCTIONS },
      );
    }
    const columnName = (ref as { column?: unknown }).column;
    const distinct = (ref as { distinct?: unknown }).distinct === true;

    // `*` is only meaningful (and only legal) for COUNT.
    if (columnName === '*') {
      if (fn !== 'COUNT') {
        throw new ReportQueryValidationError(
          'INVALID_AGGREGATE',
          `"${fn}(*)" is not valid; only COUNT accepts '*'.`,
          { alias, fn },
        );
      }
      return { kind: 'aggregate', fn: fn as AggregateFunction, column: '*', distinct };
    }

    return {
      kind: 'aggregate',
      fn: fn as AggregateFunction,
      column: this.resolveColumn(columns, columnName, entityName),
      distinct,
    };
  }

  /**
   * Validates one filter: operator from the closed union, value shape matched to the
   * operator, `$placeholders` resolved, and the value's type matched to the column's.
   *
   * Everything except the last two of those is mode-independent. Resolution and the
   * type check it feeds apply only to values that are known now, which in declaration
   * mode excludes `$name` placeholders — see `resolveValue` below.
   */
  private validateFilter(
    columns: Map<string, DatabaseColumn>,
    filter: unknown,
    entityName: string,
    index: number,
    parameters: Record<string, unknown>,
    mode: ValidationMode,
  ): ResolvedFilter {
    if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new ReportQueryValidationError('INVALID_OPERATOR', 'Filter must be an object.', {
        filter,
      });
    }
    const clause = filter as { column?: unknown; operator?: unknown; value?: unknown };
    const column = this.resolveColumn(columns, clause.column, entityName);

    // Scoping is appended by the builder from the request context. A definition that
    // filters organization_id is either confused about that — which is what §17's
    // examples were before they were rewritten — or narrowing results in a way the
    // caller cannot see. Rejected rather than silently ANDed in.
    if (column.databaseName === 'organization_id') {
      throw new ReportQueryValidationError(
        'SCOPING_COLUMN_IN_DEFINITION',
        'organization_id is appended automatically and must not appear in a definition.',
        { column: column.databaseName },
      );
    }

    const operator = clause.operator;
    if (typeof operator !== 'string' || !FILTER_OPERATORS.includes(operator as FilterOperator)) {
      throw new ReportQueryValidationError(
        'INVALID_OPERATOR',
        `Operator "${String(operator)}" is not one of: ${FILTER_OPERATORS.join(', ')}.`,
        { column: column.databaseName, operator, allowed: FILTER_OPERATORS },
      );
    }
    const parameter = `f${index}`;

    if (COLUMNS_WITHOUT_A_VALUE.includes(operator as FilterOperator)) {
      if (clause.value !== undefined && clause.value !== null) {
        throw new ReportQueryValidationError(
          'FILTER_VALUE_TYPE_MISMATCH',
          `${operator} takes no value.`,
          { column: column.databaseName, operator, value: clause.value },
        );
      }
      return { column, operator: operator as FilterOperator, parameter };
    }

    if (clause.value === undefined || clause.value === null) {
      throw new ReportQueryValidationError(
        'MISSING_FILTER_VALUE',
        `${operator} requires a value.`,
        { column: column.databaseName, operator },
      );
    }

    /**
     * Resolves one filter value, in whichever mode this call is running (§3.1.1).
     *
     * `$name` means two different things at the two moments of a report's life. In
     * **resolution** mode (execution) it is a reference that must resolve *now*, because
     * the value is about to be bound into the query — so an unsupplied name is a
     * `MISSING_FILTER_VALUE`, unchanged. In **declaration** mode (P6-06) the definition
     * is only being stored, so the placeholder is accepted as a declaration and returned
     * unresolved: the caller is supplying a definition, not a report run.
     *
     * This is the **only** place the mode changes any decision, which is what keeps the
     * two paths from drifting: every other check in this method — the column allowlist,
     * the operator set, `SCOPING_COLUMN_IN_DEFINITION`, per-operator arity, and the type
     * check on every literal — runs identically in both modes.
     *
     * The name is never interpolated, only looked up in `parameters` (and, at execution,
     * bound via `setParameter`), so an unresolved placeholder is a stored string rather
     * than anything that reaches SQL as text.
     *
     * `declared: true` marks a value that must **not** be type-checked against the
     * column. That exemption is the narrowest one that works: the type check exists to
     * catch a value a caller can fix, and a placeholder's type is knowable only once it
     * resolves. A literal beside it in the same filter is still checked.
     */
    const resolveValue = (value: unknown): { value: unknown; declared: boolean } => {
      if (typeof value !== 'string' || !value.startsWith('$')) {
        return { value, declared: false };
      }

      if (mode === 'declaration') {
        return { value, declared: true };
      }

      const name = value.slice(1);
      if (!(name in parameters) || parameters[name] === undefined) {
        throw new ReportQueryValidationError(
          'MISSING_FILTER_VALUE',
          `Filter placeholder "${value}" was not supplied.`,
          { column: column.databaseName, placeholder: value },
        );
      }
      return { value: parameters[name], declared: false };
    };

    if (LIST_OPERATORS.includes(operator as FilterOperator)) {
      if (!Array.isArray(clause.value)) {
        throw new ReportQueryValidationError(
          'FILTER_VALUE_TYPE_MISMATCH',
          `${operator} requires an array of values.`,
          { column: column.databaseName, operator, value: clause.value },
        );
      }
      if (operator === 'BETWEEN' && clause.value.length !== 2) {
        throw new ReportQueryValidationError(
          'FILTER_VALUE_TYPE_MISMATCH',
          'BETWEEN requires exactly two values.',
          { column: column.databaseName, count: clause.value.length },
        );
      }
      if (clause.value.length === 0) {
        throw new ReportQueryValidationError(
          'FILTER_VALUE_TYPE_MISMATCH',
          `${operator} requires at least one value.`,
          { column: column.databaseName, operator },
        );
      }
      const resolved = clause.value.map(resolveValue);
      for (const { value, declared } of resolved) {
        // A literal in the same list is still type-checked; only a declared
        // placeholder is exempt, and only until it resolves at execution.
        if (!declared) this.assertValueMatchesColumn(column, value, operator as string);
      }
      return {
        column,
        operator: operator as FilterOperator,
        value: resolved.map((entry) => entry.value),
        parameter,
      };
    }

    if (Array.isArray(clause.value)) {
      throw new ReportQueryValidationError(
        'FILTER_VALUE_TYPE_MISMATCH',
        `${operator} takes a single value; use IN/NOT IN for a list.`,
        { column: column.databaseName, operator },
      );
    }
    const resolved = resolveValue(clause.value);
    if (!resolved.declared) {
      this.assertValueMatchesColumn(column, resolved.value, operator as string);
    }
    return {
      column,
      operator: operator as FilterOperator,
      value: resolved.value,
      parameter,
    };
  }

  /**
   * Type-checks a filter value against its column's family.
   *
   * An unrecognised column type is *not* rejected: the check exists to catch a
   * mismatch a caller can fix, and refusing to guess is safer than inventing a rule
   * for a type this table does not cover.
   */
  private assertValueMatchesColumn(
    column: DatabaseColumn,
    value: unknown,
    operator: string,
  ): void {
    const family = TYPE_FAMILIES[column.type.toLowerCase()];
    if (!family) return;

    const fail = (expected: string) =>
      new ReportQueryValidationError(
        'FILTER_VALUE_TYPE_MISMATCH',
        `Filter on "${column.databaseName}" (${column.type}) expects ${expected}, received ${describe(value)}.`,
        { column: column.databaseName, columnType: column.type, operator, value },
      );

    switch (family) {
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) return;
        if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return;
        throw fail('a number');
      case 'date':
        if (value instanceof Date && !Number.isNaN(value.getTime())) return;
        if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return;
        throw fail('a Date or an ISO-8601 date string');
      case 'uuid':
        if (typeof value === 'string' && UUID_RE.test(value)) return;
        throw fail('a UUID string');
      case 'boolean':
        if (typeof value === 'boolean') return;
        throw fail('a boolean');
      case 'text':
        if (typeof value === 'string') return;
        throw fail('a string');
    }
  }

  /**
   * Resolves a `group_by` / `order_by` target: **output alias first, then source
   * column**, the rule §17 and `query-definition.ts` both state. The order matters —
   * an alias shadows a same-named source column, because the alias is what the query
   * actually selects, and grouping by the raw column instead is the "succeeds with
   * wrong data" failure §17's preamble calls out.
   */
  private resolveTarget(
    validatedColumns: { alias: string; ref: ResolvedRef }[],
    columns: Map<string, DatabaseColumn>,
    target: unknown,
    entityName: string,
  ): ResolvedRef {
    if (typeof target !== 'string' || target.length === 0) {
      throw new ReportQueryValidationError('UNKNOWN_OUTPUT_ALIAS', 'Expected an alias or column.', {
        target,
      });
    }
    const byAlias = validatedColumns.find((c) => c.alias === target);
    if (byAlias) return byAlias.ref;

    const byColumn = columns.get(target);
    if (byColumn) return { kind: 'column', column: byColumn };

    throw new ReportQueryValidationError(
      'UNKNOWN_OUTPUT_ALIAS',
      `"${target}" is neither an output alias nor a column on ${entityName}.`,
      { target, source: entityName, aliases: validatedColumns.map((c) => c.alias) },
    );
  }

  /**
   * Validates a definition at **execution** time and returns the only shape the
   * builder accepts.
   *
   * Every `$name` placeholder must resolve from `context.parameters` (§3.1.1), so a
   * definition whose parameters were not supplied fails here rather than binding its own
   * `$name` text as a value. That strictness is why declaration-time validation is a
   * separate entry point below rather than a relaxation of this one — and why
   * `parameters` staying optional here is not an invitation to omit it on an execution
   * path.
   *
   * A missing `organizationId` throws a plain `Error`, not a
   * `ReportQueryValidationError`: that is a wiring fault in the caller's own code, not
   * something a definition author can fix, and conflating the two would make the typed
   * error useless as a "bad request" signal.
   */
  async validate(definition: QueryDefinition, context: ValidateContext): Promise<ValidatedQuery> {
    return this.run(definition, context, 'resolution');
  }

  /**
   * Validates a definition at **declaration** time — §4.1's `POST` and `PUT
   * /v1/report/schemas` (P6-06) — so a definition carrying `$name` filter placeholders
   * can be stored before any report has supplied values for them.
   *
   * Everything except placeholder resolution is checked exactly as `validate()` checks
   * it: the source resolves against real entity metadata, every column, operator, bucket
   * unit and aggregate comes from its closed set, `organization_id` may not appear in
   * the definition, `limit`/`group_by`/`order_by` are validated, and every **literal**
   * filter value is still type-checked against its column. The single deferred check is
   * the one that needs values no report has supplied yet (§3.1.1's "resolved from the
   * report parameters at execution time"), and `ReportJobService` re-validates in
   * resolution mode when the report actually runs, so the deferral moves a rejection
   * later rather than removing it.
   *
   * Returns `void` deliberately. The declaration-mode pipeline still holds unresolved
   * placeholders in `ResolvedFilter.value`, which is not a shape the builder may receive
   * — `ValidatedQuery` promises "its value checked" — so returning nothing makes that
   * unreachable rather than a comment asking callers to be careful.
   */
  async validateDeclaration(
    definition: QueryDefinition,
    context: ValidateDeclarationContext,
  ): Promise<void> {
    await this.run(definition, context, 'declaration');
  }

  /**
   * The one validation pipeline both entry points share.
   *
   * `mode` reaches exactly one decision — whether a `$name` placeholder must resolve now
   * or is a declaration — so the two paths cannot drift apart; a rule added here applies
   * to creation and execution alike unless it is deliberately mode-dependent.
   */
  private async run(
    definition: QueryDefinition,
    context: ValidateContext,
    mode: ValidationMode,
  ): Promise<ValidatedQuery> {
    if (!context?.organizationId) {
      throw new Error('ReportQueryValidator.validate() requires an organizationId for scoping.');
    }

    const requestedColumns = definition?.columns;
    if (
      !requestedColumns ||
      typeof requestedColumns !== 'object' ||
      Array.isArray(requestedColumns) ||
      Object.keys(requestedColumns).length === 0
    ) {
      throw new ReportQueryValidationError('EMPTY_COLUMNS', 'Definition selects no columns.');
    }

    const source = await this.resolveSource(definition);

    const columns = Object.entries(requestedColumns).map(([alias, ref]) => ({
      alias,
      ref: this.resolveRef(source.columns, alias, ref as ColumnRef, source.entityName),
    }));

    const limit = definition.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_REPORT_LIMIT)) {
      throw new ReportQueryValidationError(
        'INVALID_LIMIT',
        `limit must be an integer between 1 and ${MAX_REPORT_LIMIT}.`,
        { limit },
      );
    }

    const parameters = context.parameters ?? {};
    const filters = (definition.filters ?? []).map((filter, index) =>
      this.validateFilter(source.columns, filter, source.entityName, index, parameters, mode),
    );

    const groupBy = (definition.group_by ?? []).map((target) => {
      const ref = this.resolveTarget(columns, source.columns, target, source.entityName);
      // GROUP BY SUM(x) is not valid SQL: grouping by an aggregate is rejected here
      // rather than left for Postgres to reject in the middle of a job.
      if (ref.kind === 'aggregate') {
        throw new ReportQueryValidationError(
          'INVALID_GROUP_TARGET',
          `Cannot group by aggregated output "${target}"; group by its underlying column or bucket.`,
          { target },
        );
      }
      return { target, ref };
    });

    const orderBy = (definition.order_by ?? []).map((clause) => {
      const direction = clause?.direction;
      if (direction !== 'ASC' && direction !== 'DESC') {
        throw new ReportQueryValidationError(
          'INVALID_ORDER_DIRECTION',
          `Order direction must be ASC or DESC, received ${String(direction)}.`,
          { column: clause?.column, direction },
        );
      }
      return {
        target: clause.column,
        ref: this.resolveTarget(columns, source.columns, clause.column, source.entityName),
        direction,
      };
    });

    return {
      source: { entityName: source.entityName, tableName: source.tableName },
      columns,
      filters,
      groupBy,
      orderBy,
      limit,
      organizationId: context.organizationId,
    };
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return `a ${typeof value}`;
}
