import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { TaxRatesController } from './tax-rates.controller';
import { TaxRatesService } from '../services/tax-rates.service';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';

/**
 * Verification of the P3-04 tax-rate routes (`docs/phase3-scoping-plan.md` §4).
 *
 * The controller is thin, so the contract is what matters:
 *
 *   - reads are guarded by `finance:read` (the EXISTING permission, so a read-only
 *     finance role can see the rates an invoice was taxed at);
 *   - the write is guarded by `finance:admin`, NOT `finance:create` — §4 calls tax
 *     configuration "compliance-sensitive", and a front-desk role holding
 *     `finance:create` must not be able to change the rates it bills at;
 *   - no route accepts an organization from the request, so a caller cannot read or
 *     write another tenant's rates.
 */
describe('TaxRatesController', () => {
  const reflector = new Reflector();
  const permissionsFor = (handler: string): RequiredPermission[] | undefined =>
    reflector.get<RequiredPermission[]>(PERMISSIONS_KEY, (TaxRatesController.prototype as never)[handler] as Function);

  let controller: TaxRatesController;
  let mockService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
  };

  const rate = {
    id: 'rate-1',
    organization_id: 'org-1',
    name: 'GST',
    code: 'GST',
    rate: '18.00',
  };

  beforeEach(async () => {
    mockService = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxRatesController],
      providers: [{ provide: TaxRatesService, useValue: mockService }],
    }).compile();

    controller = module.get<TaxRatesController>(TaxRatesController);
  });

  it('delegates the list query to the service unchanged', async () => {
    const query = { page: 1, limit: 20, is_active: true };
    const page = { data: [rate], total: 1, page: 1, limit: 20 };
    mockService.findAll.mockResolvedValue(page);

    await expect(controller.findAll(query)).resolves.toEqual(page);
    expect(mockService.findAll).toHaveBeenCalledWith(query);
  });

  it('delegates the id lookup to the service', async () => {
    mockService.findOne.mockResolvedValue(rate);

    await expect(controller.findOne('rate-1')).resolves.toEqual(rate);
    expect(mockService.findOne).toHaveBeenCalledWith('rate-1');
  });

  it('delegates creation to the service', async () => {
    const dto = { name: 'GST', code: 'GST', rate: '18.00' };
    mockService.create.mockResolvedValue(rate);

    await expect(controller.create(dto)).resolves.toEqual(rate);
    expect(mockService.create).toHaveBeenCalledWith(dto);
  });

  it('never accepts an organization from the caller', async () => {
    // The organization is derived inside the service from the authorized tenant
    // context. If a route ever grew an organization parameter, this fails.
    mockService.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    mockService.findOne.mockResolvedValue(rate);
    mockService.create.mockResolvedValue(rate);

    expect(TaxRatesController.prototype.findAll.length).toBe(1);
    expect(TaxRatesController.prototype.findOne.length).toBe(1);
    expect(TaxRatesController.prototype.create.length).toBe(1);
  });

  it('guards both reads with the existing finance:read permission', () => {
    expect(permissionsFor('findAll')).toEqual([{ resource: 'finance', action: 'read' }]);
    expect(permissionsFor('findOne')).toEqual([{ resource: 'finance', action: 'read' }]);
  });

  it('guards the write with finance:admin, not finance:create', () => {
    // §4: a role may hold finance:create to raise invoices without being able to
    // change the rates those invoices are taxed at.
    expect(permissionsFor('create')).toEqual([{ resource: 'finance', action: 'admin' }]);
  });
});
