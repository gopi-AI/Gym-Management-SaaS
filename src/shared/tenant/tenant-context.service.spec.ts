import { TenantContextService } from './tenant-context.service';
import { IdentityService } from '../../identity/services/identity.service';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Repository } from 'typeorm';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { tenantAsyncLocal } from './tenant-context.store';

describe('TenantContextService — Tenant Isolation (H4)', () => {
  let service: TenantContextService;
  let mockIdentityService: Record<string, jest.Mock>;
  let mockBranchRepository: Record<string, jest.Mock>;

  beforeEach(() => {
    mockIdentityService = {
      isUserInOrganization: jest.fn(),
    };

    mockBranchRepository = {
      findOne: jest.fn(),
    };

    service = new TenantContextService(
      mockIdentityService as unknown as IdentityService,
      mockBranchRepository as unknown as Repository<Branch>,
    );
  });

  describe('cross-organization access', () => {
    it('rejects organization access when user is not a member (403)', async () => {
      mockIdentityService.isUserInOrganization.mockResolvedValue(false);

      await service.runWithContext({ userId: 'user-1' }, async () => {
        await expect(
          service.requireOrganizationAccess('org-A'),
        ).rejects.toThrowError('Access to this organization is not allowed');
      });
    });

    it('allows organization access when user is an active member', async () => {
      mockIdentityService.isUserInOrganization.mockResolvedValue(true);

      await service.runWithContext({ userId: 'user-1' }, async () => {
        await expect(
          service.requireOrganizationAccess('org-A'),
        ).resolves.toBe('org-A');
        expect(mockIdentityService.isUserInOrganization).toHaveBeenCalledWith(
          'user-1',
          'org-A',
        );
      });
    });

    it('throws 401 when no authenticated user is in context', async () => {
      await service.runWithContext({}, async () => {
        await expect(
          service.requireOrganizationAccess('org-A'),
        ).rejects.toThrowError('Authentication required');
      });
    });
  });

  describe('branch isolation', () => {
    beforeEach(() => {
      mockIdentityService.isUserInOrganization.mockResolvedValue(true);
    });

    it('allows branch access when branch belongs to the same org', async () => {
      const branch = { id: 'branch-1', organization_id: 'org-A', is_active: true } as Branch;
      mockBranchRepository.findOne.mockResolvedValue(branch);

      await service.runWithContext({ userId: 'user-1' }, async () => {
        const result = await service.requireBranchAccess('org-A', 'branch-1');
        expect(result).toBe(branch);
        expect(mockBranchRepository.findOne).toHaveBeenCalledWith({
          where: { id: 'branch-1', organization_id: 'org-A', is_active: true },
        });
      });
    });

    it('rejects branch that belongs to a different organization (403)', async () => {
      mockBranchRepository.findOne.mockResolvedValue(null);

      await service.runWithContext({ userId: 'user-1' }, async () => {
        await expect(
          service.requireBranchAccess('org-A', 'branch-of-org-B'),
        ).rejects.toThrowError('Access to this branch is not allowed');
      });
    });

    it('rejects inactive branches', async () => {
      mockBranchRepository.findOne.mockResolvedValue(null);

      await service.runWithContext({ userId: 'user-1' }, async () => {
        await expect(
          service.requireBranchAccess('org-A', 'inactive-branch'),
        ).rejects.toThrowError('Access to this branch is not allowed');
      });
    });
  });
});