import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from '../services/payments.service';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let mockService: Record<string, jest.Mock>;
  const reflector = new Reflector();

  const permissionsFor = (handler: string): RequiredPermission[] | undefined =>
    reflector.get<RequiredPermission[]>(
      PERMISSIONS_KEY,
      controller[handler as keyof PaymentsController] as Function,
    );

  beforeEach(async () => {
    mockService = { findAll: jest.fn(), findOne: jest.fn(), recordForInvoice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: mockService }],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists and fetches payments scoped by the caller query/params', async () => {
    const query = { page: 1, limit: 20, invoice_id: 'inv-1' };
    mockService.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    mockService.findOne.mockResolvedValue({ id: 'pay-1' });

    await controller.findAll(query);
    expect(mockService.findAll).toHaveBeenCalledWith(query);

    await controller.findOne('pay-1');
    expect(mockService.findOne).toHaveBeenCalledWith('pay-1');
  });

  it('records a payment against the invoice in the path', async () => {
    const dto = { amount: 20, payment_method: 'cash' };
    mockService.recordForInvoice.mockResolvedValue({ id: 'pay-1' });

    await controller.recordForInvoice('inv-1', dto as never);

    expect(mockService.recordForInvoice).toHaveBeenCalledWith('inv-1', dto);
  });

  it('guards reads with finance:read and money-taking with finance:record-payment', () => {
    expect(permissionsFor('findAll')).toEqual([{ resource: 'finance', action: 'read' }]);
    expect(permissionsFor('findOne')).toEqual([{ resource: 'finance', action: 'read' }]);
    expect(permissionsFor('recordForInvoice')).toEqual([
      { resource: 'finance', action: 'record-payment' },
    ]);
  });
});
