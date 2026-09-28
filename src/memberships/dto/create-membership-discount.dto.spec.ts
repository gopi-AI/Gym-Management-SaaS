import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMembershipDiscountDto } from './create-membership-discount.dto';

/**
 * Input-contract regression tests for `POST /v1/memberships/:id/discount`.
 *
 * The table also enforces `CHK_membership_discounts_amount`
 * (`amount > 0 AND (discount_type <> 'percentage' OR amount <= 100)`). The
 * percentage ceiling is deliberately NOT on this DTO: class-validator has no
 * conditional-validator precedent in this codebase, and `@ValidateIf` would gate
 * every validator on the property (disabling `@Min` for fixed discounts). It is
 * enforced by `MembershipsService.addDiscount()` instead, and the last test here
 * pins that split so the two halves cannot drift apart silently.
 */
const errorsFor = async (payload: Record<string, unknown>) => {
  const instance = plainToInstance(CreateMembershipDiscountDto, payload);
  return validate(instance, { skipMissingProperties: true });
};

describe('CreateMembershipDiscountDto', () => {
  it('accepts a fixed discount', async () => {
    expect(await errorsFor({ discount_type: 'fixed', amount: 20 })).toHaveLength(0);
  });

  it('accepts a percentage discount within the table constraint', async () => {
    expect(await errorsFor({ discount_type: 'percentage', amount: 100 })).toHaveLength(0);
  });

  it('accepts a two-decimal amount with an explicit ISO window', async () => {
    expect(
      await errorsFor({
        discount_type: 'fixed',
        amount: 12.34,
        starts_at: '2026-01-01T00:00:00.000Z',
        ends_at: '2026-02-01T00:00:00.000Z',
      }),
    ).toHaveLength(0);
  });

  it('rejects an unknown discount_type', async () => {
    expect((await errorsFor({ discount_type: 'bogus', amount: 10 })).length).toBeGreaterThan(0);
  });

  const invalidAmounts = [0, -1, -0.01, 1.234, 'ten'];

  it.each(invalidAmounts)('rejects amount %p', async (amount) => {
    expect((await errorsFor({ discount_type: 'fixed', amount })).length).toBeGreaterThan(0);
  });

  it('rejects a non-ISO date', async () => {
    expect(
      (await errorsFor({ discount_type: 'fixed', amount: 10, starts_at: 'soon' })).length,
    ).toBeGreaterThan(0);
  });

  it('does not itself cap a percentage at 100 — the service and the table CHECK own that ceiling', async () => {
    // If this starts failing, the guard in `MembershipsService.addDiscount()` has
    // either become redundant or moved into the DTO, and its regression tests in
    // memberships.service.spec.ts should move with it.
    expect(await errorsFor({ discount_type: 'percentage', amount: 150 })).toHaveLength(0);
  });
});
