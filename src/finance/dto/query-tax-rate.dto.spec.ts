import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryTaxRateDto } from './query-tax-rate.dto';

/**
 * Regression tests for the tax-rate search query (`GET /v1/tax-rates`).
 *
 * `is_active` arrives as a STRING from a query string, so how it is converted is
 * part of the contract, not an implementation detail. `@Type(() => Boolean)`
 * looks like the obvious way to write it and is wrong: `Boolean('false')` is
 * `true`, so `?is_active=false` would filter for ACTIVE rates — the opposite of
 * the request — while still passing `@IsBoolean()`. These assertions fail if the
 * conversion is ever swapped back.
 *
 * The validation options mirror `main.ts` (`whitelist: true, transform: true`).
 */
const queryFor = (payload: Record<string, unknown>) =>
  plainToInstance(QueryTaxRateDto, payload);

describe('QueryTaxRateDto', () => {
  it('defaults to the first page of 20 when nothing is supplied', () => {
    const query = queryFor({});

    expect(query.page).toBe(1);
    expect(query.limit).toBe(20);
    expect(query.is_active).toBeUndefined();
  });

  it.each(['true', 'false'])('parses ?is_active=%s to the boolean it names', (raw) => {
    const query = queryFor({ is_active: raw });

    expect(query.is_active).toBe(raw === 'true');
  });

  it.each(['0', '1', 'FALSE'])('treats ?is_active=%s as false (only "true" means true)', (raw) => {
    // `Boolean('0')`, `Boolean('1')` and `Boolean('FALSE')` are all `true`, which is
    // exactly the trap `@Type(() => Boolean)` falls into. Under the explicit
    // comparison these are all `false`, matching `QueryInvoiceDto.outstanding_only`
    // and `QueryAttendanceRecordsDto.open_only`: only `true` / `'true'` selects the
    // true branch.
    expect(queryFor({ is_active: raw }).is_active).toBe(false);
  });

  it('distinguishes "asked for inactive rates" from "did not filter"', () => {
    // The service only adds the filter when the value is not `undefined`, so a
    // dropped `false` here would return every rate instead of the retired ones.
    expect(queryFor({ is_active: 'false' }).is_active).toBe(false);
    expect(queryFor({}).is_active).toBeUndefined();
  });

  it('still accepts a real boolean, as an in-process caller would pass', () => {
    expect(queryFor({ is_active: false }).is_active).toBe(false);
    expect(queryFor({ is_active: true }).is_active).toBe(true);
  });

  it('converts page and limit to numbers', () => {
    const query = queryFor({ page: '3', limit: '50' });

    expect(query.page).toBe(3);
    expect(query.limit).toBe(50);
  });

  it('validates the transformed payload', async () => {
    const query = queryFor({ page: '2', limit: '5', is_active: 'false' });
    const errors = await validate(query, { whitelist: true });

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['0', 'page'],
    ['-1', 'limit'],
    ['abc', 'page'],
  ])('rejects an out-of-range %s for %s', async (value, field) => {
    const errors = await validate(queryFor({ [field]: value }), { whitelist: true });

    expect(errors.map((error) => error.property)).toContain(field);
  });

  it('strips an unknown query parameter (no tenant spoofing)', async () => {
    const query = queryFor({ is_active: 'true', organization_id: 'attacker-org' });
    const errors = await validate(query, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(query).not.toHaveProperty('organization_id');
  });
});
