import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from '../services/attendance.service';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';

describe('AttendanceController', () => {
  let controller: AttendanceController;
  let mockService: Record<string, jest.Mock>;
  const reflector = new Reflector();

  const permissionsFor = (handler: string): RequiredPermission[] | undefined =>
    reflector.get<RequiredPermission[]>(
      PERMISSIONS_KEY,
      controller[handler as keyof AttendanceController] as Function,
    );

  beforeEach(async () => {
    mockService = {
      recordCheckIn: jest.fn(),
      recordCheckOut: jest.fn(),
      findRecords: jest.fn(),
      findRecord: jest.fn(),
      findAccessDecisions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [{ provide: AttendanceService, useValue: mockService }],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('routes check-in, check-out and the read endpoints to the service', async () => {
    const dto = { member_id: 'member-1' };
    mockService.recordCheckIn.mockResolvedValue({ record: { id: 'rec-1' } });
    mockService.recordCheckOut.mockResolvedValue({ record: { id: 'rec-1' } });
    mockService.findRecords.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    mockService.findRecord.mockResolvedValue({ id: 'rec-1' });
    mockService.findAccessDecisions.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await controller.checkIn(dto as never);
    expect(mockService.recordCheckIn).toHaveBeenCalledWith(dto);

    await controller.checkOut(dto as never);
    expect(mockService.recordCheckOut).toHaveBeenCalledWith(dto);

    const query = { open_only: true };
    await controller.findRecords(query);
    expect(mockService.findRecords).toHaveBeenCalledWith(query);

    await controller.findRecord('rec-1');
    expect(mockService.findRecord).toHaveBeenCalledWith('rec-1');

    await controller.findAccessDecisions({});
    expect(mockService.findAccessDecisions).toHaveBeenCalledWith({});
  });

  it('separates the check-in and check-out permissions', () => {
    // @RequirePermissions ANDs its entries, which is exactly why check-out is its
    // own route: a check-in-only operator must not be able to check members out.
    expect(permissionsFor('checkIn')).toEqual([{ resource: 'attendance', action: 'check-in' }]);
    expect(permissionsFor('checkOut')).toEqual([{ resource: 'attendance', action: 'check-out' }]);
    expect(permissionsFor('findRecords')).toEqual([{ resource: 'attendance', action: 'read' }]);
    expect(permissionsFor('findRecord')).toEqual([{ resource: 'attendance', action: 'read' }]);
    expect(permissionsFor('findAccessDecisions')).toEqual([
      { resource: 'attendance', action: 'read' },
    ]);
  });
});
