import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';
import { CommissionPayoutsController } from './commission-payouts.controller';

describe('CommissionPayoutsController', () => {
  it('uses pt:payout permission for create and process, and pt:read for detail', async () => {
    const service = { create: jest.fn(), process: jest.fn(), findOne: jest.fn() };
    const controller = new CommissionPayoutsController(service as never);
    const id = '11111111-1111-4111-8111-111111111111';
    const dto = { period_start: '2026-08-01', period_end: '2026-08-31', currency: 'USD' };

    await controller.create(dto);
    await controller.process(id);
    await controller.findOne(id);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(service.process).toHaveBeenCalledWith(id);
    expect(service.findOne).toHaveBeenCalledWith(id);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CommissionPayoutsController.prototype.create))
      .toEqual([{ resource: 'pt', action: 'payout' }]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CommissionPayoutsController.prototype.process))
      .toEqual([{ resource: 'pt', action: 'payout' }]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CommissionPayoutsController.prototype.findOne))
      .toEqual([{ resource: 'pt', action: 'read' }]);
  });
});