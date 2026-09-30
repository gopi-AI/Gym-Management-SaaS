import { getMetadataArgsStorage } from 'typeorm';
import { MembershipDiscount } from './membership-discount.entity';

/**
 * Mapping regression tests for `MembershipDiscount`, read straight from TypeORM's
 * decorator metadata — no connection, no database. The migration
 * `1788965263262-CreateMembershipDiscounts` owns the real schema, so this pins the
 * half the entity controls: the physical table name, the column set and their exact
 * types, and the two non-unique indexes. A rename or type change here would
 * otherwise only surface as a runtime drift against the migration.
 *
 * Deliberately NOT asserted here: the entity declares no `@Unique`/`@Check`, so the
 * PARTIAL unique index `UQ_membership_discounts_one_active` and the three
 * `CHK_membership_discounts_*` constraints exist in the migration only and have no
 * decorator metadata to read.
 *
 * These also pin the shape the discount tie-break relies on (plan 15 Q8):
 * `starts_at`/`created_at` are `timestamptz` and `id` is a uuid, which is what makes
 * `MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER` (`starts_at DESC, created_at DESC,
 * id ASC`) a total order.
 */
const storage = getMetadataArgsStorage();
const table = storage.tables.find((t) => t.target === MembershipDiscount);
const columns = storage.columns.filter((c) => c.target === MembershipDiscount);
const columnOptions = (propertyName: string) =>
  columns.find((c) => c.propertyName === propertyName)?.options;
const columnMode = (propertyName: string) =>
  columns.find((c) => c.propertyName === propertyName)?.mode;
const indices = storage.indices.filter((i) => i.target === MembershipDiscount);
const indexColumns = (index: (typeof indices)[number]): string[] =>
  Array.isArray(index.columns) ? index.columns : [];
const indexOn = (columnName: string) => indices.find((i) => indexColumns(i).includes(columnName));
const generation = (propertyName: string) =>
  storage.generations.find((g) => g.target === MembershipDiscount && g.propertyName === propertyName);

describe('MembershipDiscount entity metadata', () => {
  it('maps to the physical table MEMBERSHIP_MEMBERSHIP_DISCOUNTS', () => {
    expect(table).toBeDefined();
    expect(table!.name).toBe('MEMBERSHIP_MEMBERSHIP_DISCOUNTS');
    expect(table!.type).toBe('regular');
  });

  it('declares exactly the columns the migration creates', () => {
    expect(columns.map((c) => c.propertyName).sort()).toEqual([
      'amount',
      'created_at',
      'discount_type',
      'ends_at',
      'id',
      'membership_id',
      'organization_id',
      'starts_at',
    ]);
  });

  it('keys the row on a generated uuid primary column', () => {
    expect(columnOptions('id')!.primary).toBe(true);
    expect(columnOptions('id')!.type).toBe('uuid');
    expect(generation('id')).toBeDefined();
    expect(generation('id')!.strategy).toBe('uuid');
  });

  it('types the tenant and membership foreign keys as uuid, NOT NULL', () => {
    for (const propertyName of ['membership_id', 'organization_id']) {
      expect(columnOptions(propertyName)!.type).toBe('uuid');
      expect(columnOptions(propertyName)!.nullable).not.toBe(true);
    }
  });

  it('stores discount_type as varchar(20) — the CHECK constraint owns the value set', () => {
    expect(columnOptions('discount_type')!.type).toBe('varchar');
    expect(columnOptions('discount_type')!.length).toBe(20);
  });

  it('stores amount as numeric(15,2), which round-trips as a string', () => {
    expect(columnOptions('amount')!.type).toBe('decimal');
    expect(columnOptions('amount')!.precision).toBe(15);
    expect(columnOptions('amount')!.scale).toBe(2);
  });

  it('makes the validity window timestamptz, with ends_at the only nullable column', () => {
    expect(columnOptions('starts_at')!.type).toBe('timestamptz');
    expect(columnOptions('starts_at')!.nullable).not.toBe(true);
    expect(columnOptions('ends_at')!.type).toBe('timestamptz');
    expect(columnOptions('ends_at')!.nullable).toBe(true);
    // Every other column is NOT NULL, so `ends_at IS NULL` is a complete test for
    // an open-ended window (the partial unique index relies on exactly that).
    const nullable = columns.filter((c) => c.options.nullable === true).map((c) => c.propertyName);
    expect(nullable).toEqual(['ends_at']);
  });

  it('auto-populates created_at on insert', () => {
    expect(columnMode('created_at')).toBe('createDate');
    expect(columnOptions('created_at')!.type).toBe('timestamptz');
  });

  it('indexes membership_id (the column the tie-break read filters on), non-unique', () => {
    const index = indexOn('membership_id');
    expect(index).toBeDefined();
    expect(index!.unique).not.toBe(true);
  });

  it('indexes organization_id, non-unique', () => {
    const index = indexOn('organization_id');
    expect(index).toBeDefined();
    expect(index!.unique).not.toBe(true);
  });

  it('declares no decorator-level unique index — the partial one is migration-only', () => {
    expect(indices.some((i) => i.unique === true)).toBe(false);
  });
});
