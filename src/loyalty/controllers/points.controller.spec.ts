import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';
import { PointsController } from './points.controller';

describe('PointsController', () => {
  const memberId = '11111111-1111-4111-8111-111111111111';
  const dto = {
    points: 25,
    reason: 'Goodwill credit',
    idempotency_key: 'idem-1',
  };

  it('delegates to LoyaltyAdjustService.adjust with the member, DTO and actor', async () => {
    const result = {
      transaction: { id: 'txn-1' },
      balance: 125,
      created: true,
    };
    const adjust = jest.fn().mockResolvedValue(result);
    const controller = new PointsController({ adjust } as never);

    const returned = await controller.adjust(memberId, dto, {
      userId: 'user-9',
      email: 'staff@example.com',
    });

    expect(adjust).toHaveBeenCalledWith(memberId, dto, 'user-9');
    expect(returned).toEqual(result);
  });

  it('passes null when no authenticated user is attached', async () => {
    const adjust = jest.fn().mockResolvedValue({});
    const controller = new PointsController({ adjust } as never);

    await controller.adjust(memberId, dto, null);

    expect(adjust).toHaveBeenCalledWith(memberId, dto, null);
  });

  it('requires loyalty:adjust', () => {
    const metadata = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PointsController.prototype.adjust,
    );
    expect(metadata).toEqual([{ resource: 'loyalty', action: 'adjust' }]);
  });
});
