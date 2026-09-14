import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from '../services/invoices.service';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';

describe('InvoicesController', () => {
  let controller: InvoicesController;
  let mockService: Record<string, jest.Mock>;
  const reflector = new Reflector();

  const permissionsFor = (handler: string): RequiredPermission[] | undefined =>
    reflector.get<RequiredPermission[]>(PERMISSIONS_KEY, controller[handler as keyof InvoicesController] as Function);

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      voidInvoice: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [{ provide: InvoicesService, useValue: mockService }],
    }).compile();

    controller = module.get<InvoicesController>(InvoicesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates listing and lookup with the caller query/params', async () => {
    const query = { page: 1, limit: 20, outstanding_only: true };
    const page = { data: [], total: 0, page: 1, limit: 20 };
    mockService.findAll.mockResolvedValue(page);
    mockService.findOne.mockResolvedValue({ invoice: { id: 'inv-1' } });

    await expect(controller.findAll(query)).resolves.toEqual(page);
    expect(mockService.findAll).toHaveBeenCalledWith(query);

    await expect(controller.findOne('inv-1')).resolves.toEqual({ invoice: { id: 'inv-1' } });
    expect(mockService.findOne).toHaveBeenCalledWith('inv-1');
  });

  it('delegates creation and voiding', async () => {
    const dto = { member_id: 'member-1', line_items: [{ description: 'Fee', quantity: 1, unit_price: 10 }] };
    mockService.create.mockResolvedValue({ invoice: { id: 'inv-1' } });
    mockService.voidInvoice.mockResolvedValue({ id: 'inv-1', status: 'void' });

    await controller.create(dto as never);
    expect(mockService.create).toHaveBeenCalledWith(dto);

    await controller.voidInvoice('inv-1');
    expect(mockService.voidInvoice).toHaveBeenCalledWith('inv-1');
  });

  it('guards every route with a finance permission', () => {
    expect(permissionsFor('findAll')).toEqual([{ resource: 'finance', action: 'read' }]);
    expect(permissionsFor('findOne')).toEqual([{ resource: 'finance', action: 'read' }]);
    expect(permissionsFor('create')).toEqual([{ resource: 'finance', action: 'create' }]);
    expect(permissionsFor('voidInvoice')).toEqual([{ resource: 'finance', action: 'update' }]);
  });
});
