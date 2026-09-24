import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { TaxRatesService } from './tax-rates.service';
import { TaxRate } from '../entities/tax-rate.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

/**
 * P3-04 tax rate configuration — `docs/phase3-scoping-plan.md` §4.
 *
 * Two properties carry the risk here:
 *
 *   - **Tenant isolation**: a rate is per organization (§15 Q6), so every read and
 *     write must be scoped by the authorized org. A missing `organization_id` in a
 *     `findOne` would let one tenant apply another tenant's tax rate.
 *   - **"In force" means in force NOW**: `resolveActiveRates` is what decides
 *     whether an invoice is taxed, so a rate that is inactive or outside its
 *     effective window must resolve to NOTHING. The caller turns "nothing" into a
 *     rejected invoice, which is far safer than silently charging no tax.
 */
describe('TaxRatesService', () => {
  let service: TaxRatesService;
  let mockRepo: Record<string, jest.Mock>;
  let mockTenantContext: Record<string, jest.Mock>;

  const orgId = '11111111-1111-4111-8111-111111111111';

  const rate = (overrides: Partial<TaxRate> = {}): TaxRate =>
    ({
      id: 'rate-1',
      organization_id: orgId,
      name: 'GST',
      code: 'GST',
      rate: '18.00',
      is_inclusive: false,
      is_active: true,
      effective_from: new Date('2026-01-01T00:00:00.000Z'),
      effective_to: null,
      ...overrides,
    }) as TaxRate;

  beforeEach(async () => {
    mockRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity: object) => entity),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(null),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxRatesService,
        { provide: getRepositoryToken(TaxRate), useValue: mockRepo },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compile();

    service = module.get<TaxRatesService>(TaxRatesService);
  });

  describe('authorized organization', () => {
    it('refuses when no organization context is available', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(null);

      await expect(service.findAll({})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('delegates to requireOrganizationAccess when the caller named an organization', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue('org-from-header');
      mockTenantContext.requireOrganizationAccess.mockResolvedValue('org-from-header');
      mockRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({});

      expect(mockTenantContext.requireOrganizationAccess).toHaveBeenCalledWith('org-from-header');
      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: 'org-from-header' }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes the list to the authorized organization with pagination', async () => {
      await service.findAll({ page: 2, limit: 5 });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith({
        where: { organization_id: orgId },
        order: { code: 'ASC' },
        take: 5,
        skip: 5,
      });
    });

    it('adds the is_active filter only when the caller asked for one', async () => {
      // `false` must survive: `if (query.is_active)` would drop it and return the
      // inactive rates a caller explicitly wanted to see.
      await service.findAll({ is_active: false });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organization_id: orgId, is_active: false } }),
      );
    });
  });

  describe('findOne', () => {
    it('scopes the lookup to the authorized organization', async () => {
      const row = rate();
      mockRepo.findOne.mockResolvedValue(row);

      await expect(service.findOne('rate-1')).resolves.toEqual(row);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'rate-1', organization_id: orgId },
      });
    });

    it('throws NotFoundException for a rate in another organization', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('someone-elses-rate')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = { name: 'GST', code: 'gst', rate: '18.00' };

    it('upper-cases the code before checking for a duplicate AND before storing it', async () => {
      // Lower-casing only at insert time would let a concurrent `gst` slip past a
      // check for `GST`; both sides must use the same normalised form.
      await service.create({ ...dto, code: 'gSt' });

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { organization_id: orgId, code: 'GST' },
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: orgId, code: 'GST' }),
      );
    });

    it('rejects a duplicate code within the organization with a 409', async () => {
      mockRepo.findOne.mockResolvedValue(rate());

      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an inclusive rate of 100% or more', async () => {
      // A 100% inclusive rate would make the net zero; the DB CHECK constraint
      // enforces this too, and the service turns the violation into a 400.
      await expect(
        service.create({ ...dto, rate: '100.00', is_inclusive: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('allows an exclusive rate of 100% or more', async () => {
      await service.create({ ...dto, rate: '100.00', is_inclusive: false });

      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('defaults to exclusive and active, with an open-ended window', async () => {
      await service.create(dto);

      const created = mockRepo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.is_inclusive).toBe(false);
      expect(created.is_active).toBe(true);
      expect(created.effective_to).toBeNull();
      expect(created.effective_from).toBeInstanceOf(Date);
    });

    it('rejects a window that ends before it starts', async () => {
      await expect(
        service.create({ ...dto, effective_from: '2026-06-01', effective_to: '2026-05-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('resolveActiveRates', () => {
    const at = new Date('2026-03-15T12:00:00.000Z');

    it('returns nothing (without querying) when no codes were requested', async () => {
      // The backwards-compatibility path: a Phase 1 invoice has no tax_code at all,
      // so this must not touch the database and must not be an error.
      await expect(service.resolveActiveRates(orgId, ['', ''], at)).resolves.toEqual(new Map());
      expect(mockRepo.find).not.toHaveBeenCalled();
    });

    it('resolves a code case-insensitively and keys the map by the canonical code', async () => {
      mockRepo.find.mockResolvedValue([rate({ code: 'GST' })]);

      const resolved = await service.resolveActiveRates(orgId, ['gst'], at);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { organization_id: orgId, code: In(['GST']), is_active: true },
      });
      expect(resolved.get('GST')).toBeDefined();
    });

    it('rejects an unknown code through unresolvedCodes so the caller can 400', async () => {
      mockRepo.find.mockResolvedValue([rate({ code: 'GST' })]);

      const resolved = await service.resolveActiveRates(orgId, ['GST', 'TYPO'], at);

      expect(TaxRatesService.unresolvedCodes(['GST', 'TYPO'], resolved)).toEqual(['TYPO']);
    });

    it('does not resolve a rate whose window has not opened yet', async () => {
      // An invoice raised today must use the rate in force today, not one that has
      // been pre-configured for a future date — hence the query is deliberately
      // wide and the window is applied in code.
      mockRepo.find.mockResolvedValue([
        rate({ effective_from: new Date('2026-07-01T00:00:00.000Z') }),
      ]);

      await expect(service.resolveActiveRates(orgId, ['GST'], at)).resolves.toEqual(new Map());
    });

    it('does not resolve a rate whose window has closed', async () => {
      mockRepo.find.mockResolvedValue([
        rate({ effective_to: new Date('2026-02-01T00:00:00.000Z') }),
      ]);

      await expect(service.resolveActiveRates(orgId, ['GST'], at)).resolves.toEqual(new Map());
    });

    it('resolves a rate whose window contains the instant, inclusive of both bounds', async () => {
      mockRepo.find.mockResolvedValue([
        rate({
          effective_from: new Date('2026-03-15T12:00:00.000Z'),
          effective_to: new Date('2026-03-15T12:00:00.000Z'),
        }),
      ]);

      const resolved = await service.resolveActiveRates(orgId, ['GST'], at);

      expect(resolved.get('GST')).toBeDefined();
    });

    it('resolves an open-ended rate (effective_to null)', async () => {
      mockRepo.find.mockResolvedValue([rate({ effective_to: null })]);

      const resolved = await service.resolveActiveRates(orgId, ['GST'], at);

      expect(resolved.get('GST')).toBeDefined();
    });

    it('reads through the caller transaction when a manager is supplied', async () => {
      // `InvoicesService` passes its transaction so the rate read runs on the same
      // connection as the invoice write and cannot see a different snapshot.
      const managerRepo = {
        find: jest.fn().mockResolvedValue([rate()]),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerRepo),
      } as unknown as EntityManager;

      const resolved = await service.resolveActiveRates(orgId, ['GST'], at, manager);

      expect(manager.getRepository).toHaveBeenCalledWith(TaxRate);
      expect(managerRepo.find).toHaveBeenCalled();
      expect(mockRepo.find).not.toHaveBeenCalled();
      expect(resolved.get('GST')).toBeDefined();
    });

    it('deduplicates the requested codes rather than querying once per line', async () => {
      mockRepo.find.mockResolvedValue([rate()]);

      await service.resolveActiveRates(orgId, ['GST', 'gst', 'GST'], at);

      // One query for three lines, and the codes collapse to a single canonical
      // form — asserted against `In()` itself so the shape of TypeORM's operator
      // is not duplicated here.
      expect(mockRepo.find).toHaveBeenCalledTimes(1);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { organization_id: orgId, code: In(['GST']), is_active: true },
      });
    });
  });

  describe('unresolvedCodes', () => {
    it('ignores empty codes, which mean "no tax was requested"', () => {
      expect(TaxRatesService.unresolvedCodes(['', '  '], new Map())).toEqual([]);
    });

    it('reports each missing code once, upper-cased', () => {
      const resolved = new Map([['GST', rate()]]);

      expect(TaxRatesService.unresolvedCodes(['gst', 'typo', 'TYPO'], resolved)).toEqual(['TYPO']);
    });
  });
});
