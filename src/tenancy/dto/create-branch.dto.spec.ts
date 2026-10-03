import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBranchDto } from './create-branch.dto';

/**
 * DEF-03: `POST /v1/branches` with an omitted `address`/`phone` reached Postgres
 * as NULL against two NOT NULL columns and returned a 500. The DTO now requires
 * both, so the global ValidationPipe (`whitelist: true, transform: true` in
 * `main.ts`) answers 400 and names the field.
 *
 * The bounds mirrored here are the column lengths: `address` varchar(500),
 * `phone` varchar(50) (`TENANCY_BRANCHES`).
 */
const branchFor = (payload: Record<string, unknown>) =>
  plainToInstance(CreateBranchDto, payload);

const COMPLETE = {
  organization_id: '9a1f3a1e-0f9a-4b0e-9f9a-4b0e9f9a4b0e',
  name: 'Gate Branch',
  address: '1 Gate Street',
  phone: '+1-555-0100',
};

const invalidProperties = async (payload: Record<string, unknown>) =>
  (await validate(branchFor(payload), { whitelist: true })).map((error) => error.property);

describe('CreateBranchDto', () => {
  it('accepts a complete branch', async () => {
    await expect(invalidProperties(COMPLETE)).resolves.toEqual([]);
  });

  it('rejects a missing address', async () => {
    const { address: _omitted, ...withoutAddress } = COMPLETE;

    await expect(invalidProperties(withoutAddress)).resolves.toContain('address');
  });

  it('rejects a missing phone', async () => {
    const { phone: _omitted, ...withoutPhone } = COMPLETE;

    await expect(invalidProperties(withoutPhone)).resolves.toContain('phone');
  });

  it.each(['address', 'phone'])('rejects an empty %s', async (field) => {
    await expect(invalidProperties({ ...COMPLETE, [field]: '' })).resolves.toContain(field);
  });

  it.each([
    ['address', 501],
    ['phone', 51],
  ])('rejects an over-long %s', async (field, length) => {
    await expect(
      invalidProperties({ ...COMPLETE, [field]: 'x'.repeat(length) }),
    ).resolves.toContain(field);
  });
});
