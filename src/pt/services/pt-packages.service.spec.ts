import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PtPackagesService } from './pt-packages.service';
import { PTPackage } from '../entities/pt-package.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OrganizationsService } from '../../tenancy/services/organizations.service';

describe('PtPackagesService', () => {
  let service!: PtPackagesService;
  let mockPackageRepo!: Record<string, jest.Mock>;
  let mockTenantContext!: Record<string, jest.Mock>;
  let mockOrganizationsService!: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const otherOrgId = 'org-999';

  const packageFixture = {
    id: 'package-1',
    organization_id: orgId,
    name: '10 Session Pack',
    session_count: 10,
    price: '500.00',
    currency: 'USD',
    commission_percent: '10.00',
    is_active: true,
  } as PTPackage;

  beforeEach(async () => {
    mockPackageRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'package-1', ...dto })),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      find: jest.fn().mockResolvedValue([packageFixture]),
      findOne: jest.fn().mockResolvedValue(packageFixture),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };

    mockOrganizationsService = {
      findOne: jest.fn().mockResolvedValue({ id: orgId, currency: 'EUR' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PtPackagesService,
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OrganizationsService, useValue: mockOrganizationsService },
        { provide: getRepositoryToken(PTPackage), useValue: mockPackageRepo },
      ],
    }).compile();

    service = module.get(PtPackagesService);
  });

  const createDto = { name: '10 Session Pack', session_count: 10, price: 199.99 };

  // ---------------------------------------------------------------------------
  // Q4 — price is NET, currency is stored explicitly
  // ---------------------------------------------------------------------------

  describe('create (Q4)', () => {
    it('stores the price pre-tax, with no tax fields and no tax logic', async () => {
      await service.create(createDto);

      const payload = mockPackageRepo.create.mock.calls[0][0];
      expect(payload.price).toBe('199.99');
      // Tax handling is Phase 3 scope: the entity/creation payload has no tax key.
      expect(Object.keys(payload).filter((key) => /tax/i.test(key))).toEqual([]);
    });

    it('defaults currency to the ORGANIZATION currency, read once and stored', async () => {
      await service.create(createDto);

      expect(mockOrganizationsService.findOne).toHaveBeenCalledWith(orgId);
      expect(mockPackageRepo.create.mock.calls[0][0]).toMatchObject({
        currency: 'EUR',
      });
      expect(mockPackageRepo.save).toHaveBeenCalledTimes(1);
    });

    it('stores an explicitly supplied currency instead (normalised, org not read)', async () => {
      await service.create({ ...createDto, currency: 'gbp' });

      expect(mockPackageRepo.create.mock.calls[0][0].currency).toBe('GBP');
      expect(mockOrganizationsService.findOne).not.toHaveBeenCalled();
    });

    it('stores commission_percent as a 2-decimal value, or null when not configured', async () => {
      await service.create({ ...createDto, commission_percent: 12.5 });
      expect(mockPackageRepo.create.mock.calls[0][0].commission_percent).toBe('12.50');

      mockPackageRepo.create.mockClear();
      await service.create(createDto);
      expect(mockPackageRepo.create.mock.calls[0][0].commission_percent).toBeNull();
    });

    it('scopes the created package to the authorized organization', async () => {
      await service.create(createDto);

      expect(mockPackageRepo.create.mock.calls[0][0].organization_id).toBe(orgId);
    });

    it('rejects an inverted validity window', async () => {
      await expect(
        service.create({
          ...createDto,
          valid_from: '2026-12-01',
          valid_to: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPackageRepo.save).not.toHaveBeenCalled();
    });

    it('fails clearly when the organization cannot be read for the currency default', async () => {
      mockOrganizationsService.findOne.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        'Organization not found',
      );
      expect(mockPackageRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Org-scoping
  // ---------------------------------------------------------------------------

  describe('org-scoping', () => {
    it('findAll filters on the authorized organization and active packages', async () => {
      await service.findAll();

      expect(mockPackageRepo.find).toHaveBeenCalledWith({
        where: { organization_id: orgId, is_active: true },
        order: { name: 'ASC' },
      });
    });

    it('findOne scopes by organization_id', async () => {
      await service.findOne('package-1');

      expect(mockPackageRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'package-1', organization_id: orgId },
      });
    });

    it('rejects a package id from another organization', async () => {
      mockPackageRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(otherOrgId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPackageRepo.findOne).toHaveBeenCalledWith({
        where: { id: otherOrgId, organization_id: orgId },
      });
    });

    it('rejects reads with no organization context at all', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(null);

      await expect(service.findAll()).rejects.toThrow(
        'Organization context not found',
      );
      expect(mockPackageRepo.find).not.toHaveBeenCalled();
    });
  });
});