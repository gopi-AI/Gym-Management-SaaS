import 'reflect-metadata';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMembershipPlanDto } from './create-membership-plan.dto';
import { UpdateMembershipPlanDto } from './update-membership-plan.dto';

/**
 * Regression tests for the membership-plan `price` contract: price is a decimal
 * string (the UI sends String(price)); it must accept the normal non-negative
 * value sent by the frontend and reject negative or malformed values.
 */
type PlanDto = CreateMembershipPlanDto | UpdateMembershipPlanDto;

const createPayload = (price: unknown) => ({
  name: 'Premium',
  price,
  currency: 'USD',
  billing_period: 'monthly',
  duration_days: 30,
});

const priceErrors = async (dtoClass: ClassConstructor<PlanDto>, payload: Record<string, unknown>) => {
  const instance = plainToInstance(dtoClass, payload);
  const errors = await validate(instance, { skipMissingProperties: true });
  return errors.filter((e) => e.property === 'price');
};

describe('membership plan price validation', () => {
  const validPrices = ['12.34', '19.99', '0', '0.00', '49.99', '1000'];

  it.each(validPrices)('CreateMembershipPlanDto accepts price %s', async (price) => {
    expect(await priceErrors(CreateMembershipPlanDto, createPayload(price))).toHaveLength(0);
  });

  it.each(validPrices)('UpdateMembershipPlanDto accepts price %s', async (price) => {
    expect(await priceErrors(UpdateMembershipPlanDto, { price })).toHaveLength(0);
  });

  const invalidPrices = ['-12.34', '-0.01', 'abc', '', '12,34', '1e5', ' 12.34'];

  it.each(invalidPrices)('CreateMembershipPlanDto rejects price %p', async (price) => {
    expect((await priceErrors(CreateMembershipPlanDto, createPayload(price))).length).toBeGreaterThan(0);
  });

  it.each(invalidPrices)('UpdateMembershipPlanDto rejects price %p', async (price) => {
    expect((await priceErrors(UpdateMembershipPlanDto, { price })).length).toBeGreaterThan(0);
  });

  it('CreateMembershipPlanDto rejects a numeric price (contract is a decimal string)', async () => {
    expect((await priceErrors(CreateMembershipPlanDto, createPayload(12.34))).length).toBeGreaterThan(0);
  });

  it('UpdateMembershipPlanDto accepts a payload without price (field is optional)', async () => {
    expect(await priceErrors(UpdateMembershipPlanDto, { name: 'Renamed' })).toHaveLength(0);
  });
});
