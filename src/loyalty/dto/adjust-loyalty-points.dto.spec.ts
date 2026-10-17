import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdjustLoyaltyPointsDto } from './adjust-loyalty-points.dto';

describe('AdjustLoyaltyPointsDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  function transform(payload: Record<string, unknown>): Promise<AdjustLoyaltyPointsDto> {
    return pipe.transform(payload, {
      type: 'body',
      metatype: AdjustLoyaltyPointsDto,
    }) as Promise<AdjustLoyaltyPointsDto>;
  }

  const valid = {
    points: -25,
    reason: 'Correction after a mis-scanned check-in',
    idempotency_key: 'idem-123',
  };

  it('accepts a valid signed adjustment', async () => {
    const instance = await transform(valid);

    expect(instance).toBeInstanceOf(AdjustLoyaltyPointsDto);
    expect(instance.points).toBe(-25);
  });

  it('drops undecorated properties (whitelist: true)', async () => {
    const instance = await transform({ ...valid, created_by: 'spoofed-user' });

    expect(instance).not.toHaveProperty('created_by');
    expect(instance).not.toHaveProperty('organization_id');
  });

  it.each([
    ['zero points', { ...valid, points: 0 }],
    ['fractional points', { ...valid, points: 1.5 }],
    ['above the positive cap', { ...valid, points: 100001 }],
    ['below the negative cap', { ...valid, points: -100001 }],
    ['missing reason', { points: 10, idempotency_key: 'k' }],
    ['empty reason', { ...valid, reason: '' }],
    ['reason over 500 chars', { ...valid, reason: 'x'.repeat(501) }],
    ['missing idempotency key', { points: 10, reason: 'x' }],
    ['empty idempotency key', { ...valid, idempotency_key: '' }],
    ['idempotency key over 255 chars', { ...valid, idempotency_key: 'k'.repeat(256) }],
  ])('rejects %s', async (_label, payload) => {
    await expect(transform(payload)).rejects.toThrow(BadRequestException);
  });
});
