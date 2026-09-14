import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { MembershipPlansService } from './membership-plans.service';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

describe('MembershipPlansService', () => {
  let service: MembershipPlansService;
  let mockRepo: Record<string, jest.Mock>;
  let mockTenantContext: Record<string, jest.Mock>;

  const orgId = 'org-123';

  beforeEach(async () => {
    mockRepo = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipPlansService,
        { provide: getRepositoryToken(MembershipPlan), useValue: mockRepo },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compile();

    service = module.get<MembershipPlansService>(MembershipPlansService);
  });

  describe('findAll', () => {
    it('returns paginated plans scoped to the authorized organization', async () => {
      const plans = [
        { id: 'plan-1', organization_id: orgId, name: 'Basic', is_active: true },
      ] as MembershipPlan[];
      mockRepo.findAndCount.mockResolvedValue([plans, 1]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith({
        where: { organization_id: orgId, deleted_at: IsNull() },
        order: { name: 'ASC' },
        take: 20,
        skip: 0,
      });
      expect(result.data).toEqual(plans);
      expect(result.total).toBe(1);
    });

    it('filters by is_active when provided', async () => {
      mockRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 1, limit: 20, is_active: true });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_active: true }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a plan when it exists and belongs to the authorized org', async () => {
      const plan = { id: 'plan-1', organization_id: orgId, name: 'Basic' } as MembershipPlan;
      mockRepo.findOne.mockResolvedValue(plan);

      const result = await service.findOne('plan-1');

      expect(result).toEqual(plan);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'plan-1', organization_id: orgId, deleted_at: IsNull() },
      });
    });

    it('throws NotFoundException when the plan does not exist in the org', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a plan with the authorized org ID', async () => {
      const dto = {
        name: 'Premium',
        price: '99.99',
        currency: 'USD',
        billing_period: 'monthly',
        duration_days: 30,
      };
      const saved = { ...dto, id: 'plan-new', organization_id: orgId } as MembershipPlan;
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      const result = await service.create(dto as any);

      expect(mockRepo.create).toHaveBeenCalledWith({
        ...dto,
        organization_id: orgId,
        is_active: true,
      });
      expect(result.organization_id).toBe(orgId);
    });
  });

  describe('update', () => {
    it('updates a plan when it exists and belongs to the authorized org', async () => {
      const existing = { id: 'plan-1', organization_id: orgId, name: 'Basic' } as MembershipPlan;
      mockRepo.findOne.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValue({ affected: 1 } as any);
      const updated = { ...existing, name: 'Premium' } as MembershipPlan;
      mockRepo.findOne.mockResolvedValueOnce(updated);

      const result = await service.update('plan-1', { name: 'Premium' });

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'plan-1', organization_id: orgId },
        { name: 'Premium' },
      );
      expect(result.name).toBe('Premium');
    });

    it('throws NotFoundException when updating a non-existent plan', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.update('non-existent', { name: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('organization scoping', () => {
    it('prevents cross-tenant read of a plan', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('plan-of-org-B')).rejects.toThrow(NotFoundException);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'plan-of-org-B', organization_id: orgId, deleted_at: IsNull() },
      });
    });

    it('resolves authorized org from requested org when current org is not set', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue('org-requested');
      mockTenantContext.requireOrganizationAccess.mockResolvedValue('org-requested');
      mockRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockTenantContext.requireOrganizationAccess).toHaveBeenCalledWith('org-requested');
      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: 'org-requested' }),
        }),
      );
    });

    it('throws when no org context can be resolved', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(null);

      await expect(service.findAll({})).rejects.toThrow(ForbiddenException);
    });
  });
});
