import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '../entities/payment-method.entity';
import { PaymentMethodsService } from './payment-methods.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { MembersService } from '../../members/services/members.service';

describe('PaymentMethodsService', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const memberId = '22222222-2222-4222-8222-222222222222';
  let service: PaymentMethodsService;
  let repository: Record<string, jest.Mock>;
  let membersService: { findOne: jest.Mock };

  beforeEach(async () => {
    repository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => ({ id: 'method-1', ...value })),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const module = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: getRepositoryToken(PaymentMethod), useValue: repository },
        {
          provide: TenantContextService,
          useValue: { getCurrentOrganizationId: jest.fn().mockResolvedValue(organizationId) },
        },
        { provide: MembersService, useValue: membersService = { findOne: jest.fn().mockResolvedValue({ id: memberId, organization_id: organizationId }) } },
      ],
    }).compile();
    service = module.get(PaymentMethodsService);
  });

  it('attaches a provider reference as the member default without raw card data', async () => {
    const result = await service.attachPaymentMethod(memberId, {
      stripe_customer_id: 'cus_1',
      stripe_payment_method_id: 'pm_1',
      card_brand: 'visa',
      card_last4: '4242',
    });
    expect(repository.update).toHaveBeenCalledWith(
      { organization_id: organizationId, member_id: memberId },
      { is_default: false },
    );
    expect(result).toMatchObject({ organization_id: organizationId, member_id: memberId, is_default: true, card_last4: '4242' });
    expect(result).not.toHaveProperty('card_number');
  });

  it('returns the organization-scoped default method', async () => {
    repository.findOne.mockResolvedValue({ id: 'method-1', is_default: true });
    await expect(service.getDefaultPaymentMethod(memberId)).resolves.toEqual({ id: 'method-1', is_default: true });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { organization_id: organizationId, member_id: memberId, is_default: true } });
  });

  it('supports worker lookup only with an explicit organization and member scope', async () => {
    const method = { id: 'worker-method', is_default: true };
    repository.findOne.mockResolvedValue(method);
    await expect(service.getDefaultPaymentMethodForOrganization(memberId, organizationId)).resolves.toBe(method);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { organization_id: organizationId, member_id: memberId, is_default: true },
    });
  });

  it('rejects attach and lookup for a member outside the authorized organization', async () => {
    membersService.findOne.mockResolvedValue({ id: memberId, organization_id: 'other-org' });

    await expect(service.attachPaymentMethod(memberId, {
      stripe_customer_id: 'cus_1',
      stripe_payment_method_id: 'pm_1',
      card_brand: 'visa',
      card_last4: '4242',
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getDefaultPaymentMethod(memberId)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.findOne).not.toHaveBeenCalled();
  });
});