import { Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import type { ResolvedFilter, ResolvedRef, ValidatedQuery } from '../types/validated-query';

/**
 * Renders an identifier that came from entity metadata. Never applied to a
 * caller-supplied string: every identifier reaching this function has already been
 * resolved against typeof column metadata by the validator.
 */
function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Compiles a `ValidatedQuery` into a parameterised TypeORM query (P6-02/P6-03, Phase A).
 *
 * Two properties this class is built around:
 *
 *  1. **It cannot accept an unvalidated definition.** `build()` takes a
 *     `ValidatedQuery`, not a `QueryDefinition`, so "validate before compiling" is
 *     enforced by the type system rather than by discipline. Every identifier it
 *     renders came from metadata; every value is a bound parameter.
 *  2. **The tenant filter is not part of the definition's clause list.** It is added
 *     here, from `validated.organizationId`, as the first `WHERE` term — and the
 *     validator refuses definitions that name `organization_id` at all, so a
 *     definition can neither replace nor remove it.
 *
 * Values are never interpolated: filters become `:f0`, `:f0_start`/`:f0_end`,
 * `:...f0` (spread for IN), with `setParameter()` doing the binding. `date_trunc`'s
 * unit and the aggregate function come from closed enums the validator checked.
 */
@Injectable()
export class ReportQueryBuilder {
  constructor(private readonly dataSource: DataSource) {}

  /** The compiled query, ready for `.getRawMany()`. */
  build(validated: ValidatedQuery, tableAlias = 't'): SelectQueryBuilder<Record<string, unknown>> {
    const metadata = this.dataSource.entityMetadatas.find(
      (m) => m.targetName === validated.source.entityName,
    );
    if (!metadata) {
      // Unreachable through the public path — the validator resolved this name — so
      // it is an internal invariant violation, not a bad request.
      throw new Error(
        `ReportQueryBuilder received an unresolved source "${validated.source.entityName}".`,
      );
    }

    const qb = this.dataSource
      .getRepository(metadata.target)
      .createQueryBuilder(tableAlias) as SelectQueryBuilder<Record<string, unknown>>;

    // `select` rather than `addSelect` first, so TypeORM does not also emit the
    // entity's own columns: a report returns exactly its declared aliases.
    const [first, ...rest] = validated.columns;
    qb.select(this.render(first.ref, tableAlias), first.alias);
    for (const column of rest) {
      qb.addSelect(this.render(column.ref, tableAlias), column.alias);
    }

    // The tenant filter, first and unconditional.
    qb.where(`${tableAlias}.${quote('organization_id')} = :orgId`);
    qb.setParameter('orgId', validated.organizationId);

    for (const filter of validated.filters) {
      this.applyFilter(qb, filter, tableAlias);
    }

    validated.groupBy.forEach((entry, index) => {
      const expression = this.render(entry.ref, tableAlias);
      if (index === 0) qb.groupBy(expression);
      else qb.addGroupBy(expression);
    });

    for (const order of validated.orderBy) {
      qb.addOrderBy(this.render(order.ref, tableAlias), order.direction);
    }

    if (validated.limit !== undefined) qb.limit(validated.limit);

    return qb;
  }

  /** Renders one resolved ref as SQL, from metadata names and closed enum values only. */
  private render(ref: ResolvedRef, tableAlias: string): string {
    switch (ref.kind) {
      case 'column':
        return `${tableAlias}.${quote(ref.column.databaseName)}`;
      case 'aggregate': {
        const argument =
          ref.column === '*' ? '*' : `${tableAlias}.${quote(ref.column.databaseName)}`;
        return `${ref.fn}(${ref.distinct ? 'DISTINCT ' : ''}${argument})`;
      }
      case 'bucket':
        // `unit` is one of day/week/month/quarter/year — checked in the validator.
        return `date_trunc('${ref.unit}', ${tableAlias}.${quote(ref.column.databaseName)})`;
    }
  }

  private applyFilter(
    qb: SelectQueryBuilder<Record<string, unknown>>,
    filter: ResolvedFilter,
    tableAlias: string,
  ): void {
    const column = `${tableAlias}.${quote(filter.column.databaseName)}`;

    if (filter.operator === 'IS NULL' || filter.operator === 'IS NOT NULL') {
      qb.andWhere(`${column} ${filter.operator}`);
      return;
    }

    if (filter.operator === 'BETWEEN') {
      const [from, to] = filter.value as unknown[];
      qb.andWhere(`${column} BETWEEN :${filter.parameter}_from AND :${filter.parameter}_to`);
      qb.setParameter(`${filter.parameter}_from`, from);
      qb.setParameter(`${filter.parameter}_to`, to);
      return;
    }

    if (filter.operator === 'IN' || filter.operator === 'NOT IN') {
      // `:...name` is TypeORM's spread binding: the array is expanded into one
      // placeholder per element, never joined into the SQL text.
      qb.andWhere(`${column} ${filter.operator} (:...${filter.parameter})`);
      qb.setParameter(filter.parameter, filter.value as unknown[]);
      return;
    }

    qb.andWhere(`${column} ${filter.operator} :${filter.parameter}`);
    qb.setParameter(filter.parameter, filter.value);
  }
}
