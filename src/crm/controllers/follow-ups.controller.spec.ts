import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { FollowUpsController } from './follow-ups.controller';
import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';

describe('FollowUpsController', () => {
  it('delegates the due and complete routes', async () => {
    const service: any = { listDue: jest.fn(), complete: jest.fn() };
    const controller = new FollowUpsController(service);

    await controller.due({ withinHours: 4 } as any);
    await controller.complete('fu-1', { outcome: 'spoke to them' } as any);

    expect(service.listDue).toHaveBeenCalledWith({ withinHours: 4 });
    expect(service.complete).toHaveBeenCalledWith('fu-1', { outcome: 'spoke to them' });
  });

  it('declares exact permission metadata and the §9 route surface', () => {
    const expected: Record<string, string> = { due: 'read', complete: 'update' };
    for (const [method, action] of Object.entries(expected)) {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, (FollowUpsController.prototype as any)[method]),
      ).toEqual([{ resource: 'crm', action }]);
    }

    expect(Reflect.getMetadata(PATH_METADATA, FollowUpsController)).toBe('v1/follow-ups');
    expect(
      Reflect.getMetadata(PATH_METADATA, (FollowUpsController.prototype as any).due),
    ).toBe('due');
    expect(
      Reflect.getMetadata(PATH_METADATA, (FollowUpsController.prototype as any).complete),
    ).toBe(':id/complete');
    // RequestMethod.POST === 1 — completion is a state change, not a read.
    expect(
      Reflect.getMetadata(METHOD_METADATA, (FollowUpsController.prototype as any).complete),
    ).toBe(1);
  });
});
