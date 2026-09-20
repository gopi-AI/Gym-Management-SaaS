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

export interface ValidateContext {
  /** The authorized organization. The definition never supplies this. */
  organizationId: string;
  /** Values for `$name` placeholders in `FilterClause.value`. */
  parameters?: Record<string, unknown>;
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
   */
  private validateFilter(
    columns: Map<string, DatabaseColumn>,
    filter: unknown,
    entityName: string,
    index: number,
    parameters: Record<string, unknown>,
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

    const resolvePlaceholder = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith('$')) {
        const name = value.slice(1);
        if (!(name in parameters) || parameters[name] === undefined) {
          throw new ReportQueryValidationError(
            'MISSING_FILTER_VALUE',
            `Filter placeholder "${value}" was not supplied.`,
            { column: column.databaseName, placeholder: value },
          );
        }
        return parameters[name];
      }
      return value;
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
      const values = clause.value.map(resolvePlaceholder);
      for (const value of values) this.assertValueMatchesColumn(column, value, operator as string);
      return { column, operator: operator as FilterOperator, value: values, parameter };
    }

    if (Array.isArray(clause.value)) {
      throw new ReportQueryValidationError(
        'FILTER_VALUE_TYPE_MISMATCH',
        `${operator} takes a single value; use IN/NOT IN for a list.`,
        { column: column.databaseName, operator },
      );
    }
    const value = resolvePlaceholder(clause.value);
    this.assertValueMatchesColumn(column, value, operator as string);
    return { column, operator: operator as FilterOperator, value, parameter };
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
   * Validates a definition and returns the only shape the builder accepts.
   *
   * A missing `organizationId` throws a plain `Error`, not a
   * `ReportQueryValidationError`: that is a wiring fault in the caller's own code, not
   * something a definition author can fix, and conflating the two would make the typed
   * error useless as a "bad request" signal.
   */
  async validate(definition: QueryDefinition, context: ValidateContext): Promise<ValidatedQuery> {
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
      this.validateFilter(source.columns, filter, source.entityName, index, parameters),
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
