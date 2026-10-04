import type { AggregateFunction, FilterClause, TimeBucketUnit } from './query-definition';

/** The operator union, taken from `FilterClause` rather than restated. */
export type FilterOperator = FilterClause['operator'];

/**
 * An entity column as TypeORM metadata describes it.
 *
 * Both names are carried: `databaseName` is what SQL needs, `propertyName` is what
 * error messages and any future repository-based path need.
 */
export interface DatabaseColumn {
  propertyName: string;
  databaseName: string;
  /** TypeORM's type name (`varchar`, `timestamptz`, `int`, `uuid`, `boolean`, …). */
  type: string;
  isNullable: boolean;
}

/**
 * A `ColumnRef` after validation: every identifier here has been checked against the
 * source entity's metadata, and every function/unit came from a closed set.
 */
export type ResolvedRef =
  | { kind: 'column'; column: DatabaseColumn }
  | { kind: 'aggregate'; fn: AggregateFunction; column: DatabaseColumn | '*'; distinct: boolean }
  | { kind: 'bucket'; column: DatabaseColumn; unit: TimeBucketUnit };

/** A filter with its column resolved, its value checked, and its parameter named. */
export interface ResolvedFilter {
  column: DatabaseColumn;
  operator: FilterOperator;
  /** `undefined` for `IS NULL` / `IS NOT NULL`. */
  value?: unknown;
  /** The bound parameter name the builder uses (never a literal in the string). */
  parameter: string;
}

/**
 * A definition that has passed validation — the ONLY input the builder accepts.
 *
 * The builder taking `ValidatedQuery` rather than `QueryDefinition` is deliberate:
 * it makes "an unvalidated definition cannot reach SQL" a property of the types
 * rather than a convention. `organizationId` is carried separately from the
 * definition's own filters, because the definition never supplies it.
 */
export interface ValidatedQuery {
  source: { entityName: string; tableName: string };
  columns: { alias: string; ref: ResolvedRef }[];
  filters: ResolvedFilter[];
  groupBy: { target: string; ref: ResolvedRef }[];
  orderBy: { target: string; ref: ResolvedRef; direction: 'ASC' | 'DESC' }[];
  limit?: number;
  /** The tenant the builder appends; never derived from the definition. */
  organizationId: string;
}
