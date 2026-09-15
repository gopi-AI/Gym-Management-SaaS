import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ConsentsService } from './consents.service';
import { MemberConsent } from '../entities/consent-log.entity';
import { ConsentType } from '../entities/consent-type.enum';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

describe('ConsentsService', () => {
  let service: ConsentsService;
  let mockConsentRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, jest.Mock>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const memberId = 'member-uuid-1';

  const grantDto = {
    consent_type: ConsentType.GDPR,
    is_given: true,
    given_at: '2026-09-15T10:00:00Z',
    expires_at: undefined,
    document_id: undefined,
    version: undefined,
  };

  const revokeDto = {
    consent_type: ConsentType.GDPR,
    revoked_at: '2026-09-16T10:00:00Z',
    revocation_reason: 'Member requested withdrawal',
  };

  beforeEach(async () => {
    mockConsentRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'consent-1', ...dto })),
      save: jest.fn().mockResolvedValue({ id: 'consent-1' }),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
mockOutboxService = {
      saveEvent: jest.fn().mockResolvedValue({}),
      saveEventEnvelope: jest.fn().mockResolvedValue({}),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (mgr: EntityManager) => unknown) => {
        const manager = {
          getRepository: jest.fn().mockImplementation((target: any) => {
            if (target === MemberConsent) return mockConsentRepo;
            return {};
          }),
        };
        return cb(manager as unknown as EntityManager);
      }),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn(),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsentsService,
        { provide: getRepositoryToken(MemberConsent), useValue: mockConsentRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
      ],
    }).compile();

    service = module.get<ConsentsService>(ConsentsService);
  });

  // --------------------------------------------------------------------------
  // Consent ledger correctness (append-only audit trail)
  // --------------------------------------------------------------------------

  describe('append-only consent ledger', () => {
    it('granting consent creates exactly one row (is_given = true)', async () => {
      await service.grant(memberId, grantDto);

      expect(mockConsentRepo.create).toHaveBeenCalledTimes(1);
      expect(mockConsentRepo.save).toHaveBeenCalledTimes(1);
      const createdArgs = mockConsentRepo.create.mock.calls[0][0];
      expect(createdArgs.is_given).toBe(true);
      expect(createdArgs.consent_type).toBe(ConsentType.GDPR);

      // Outbox event written inside the same transaction
      expect(mockOutboxService.saveEvent).toHaveBeenCalledWith(
        'MemberConsentGiven.v1',
        expect.any(String),
        memberId,
        expect.anything(), // transaction manager
      );
    });

    it('grant -> revoke produces two rows (no UPDATE)', async () => {
      const activeGrant = {
        id: 'consent-grant-1',
        member_id: memberId,
        consent_type: ConsentType.GDPR,
        is_given: true,
        given_at: new Date('2026-09-15T10:00:00Z'),
        created_at: new Date('2026-09-15T10:00:00Z'),
      };

      // Grant's save returns the grant
      mockConsentRepo.save.mockResolvedValueOnce(activeGrant as any);

      await service.grant(memberId, grantDto);
      expect(mockConsentRepo.create).toHaveBeenCalledTimes(1);
      expect(mockConsentRepo.save).toHaveBeenCalledTimes(1);

      // Arrange for revoke: findOne should return the active grant
      mockConsentRepo.findOne.mockResolvedValueOnce(activeGrant as any);
      // Revoke's save returns the revocation row
      mockConsentRepo.save.mockResolvedValueOnce({
        id: 'consent-revoke-1',
        member_id: memberId,
        consent_type: ConsentType.GDPR,
        is_given: false,
        given_at: new Date('2026-09-15T10:00:00Z'),
        revoked_at: new Date('2026-09-16T10:00:00Z'),
        revocation_reason: 'Member requested withdrawal',
      } as any);

      await service.revoke(memberId, revokeDto);
      expect(mockConsentRepo.create).toHaveBeenCalledTimes(2);

      // Revocation row was created (not an update)
      const revokeRow = mockConsentRepo.create.mock.calls[1][0];
      expect(revokeRow.is_given).toBe(false);
      expect(revokeRow.revoked_at).toBeDefined();
      expect(revokeRow.revocation_reason).toBe('Member requested withdrawal');

      // Revocation outbox event written inside the same transaction
      expect(mockOutboxService.saveEvent).toHaveBeenCalledWith(
        'MemberConsentRevoked.v1',
        expect.any(String),
        memberId,
        expect.anything(), // transaction manager
      );
    });
it('grant -> revoke -> grant: three rows, current status is the final grant', async () => {
      const results: any[] = [];

      // Override transaction to keep in-memory state between calls
      mockDataSource.transaction = jest.fn().mockImplementation(
        async (cb: (mgr: EntityManager) => unknown) => {
          const manager = {
            getRepository: jest.fn().mockImplementation((target: any) => {
              if (target === MemberConsent) {
                return {
                  create: jest.fn().mockImplementation((dto) => ({
                    id: 'row-' + results.length,
                    ...dto,
                    created_at: new Date(),
                  })),
                  save: jest.fn().mockImplementation(async (row) => {
                    results.push(row);
                    return row;
                  }),
                  findOne: jest.fn().mockImplementation(async ({ where }: any) => {
                    const matching = results
                      .filter(
                        (r) =>
                          r.member_id === where.member_id &&
                          r.consent_type === where.consent_type,
                      )
                      .sort(
                        (a, b) =>
                          new Date(b.created_at || Date.now()).getTime() -
                          new Date(a.created_at || 0).getTime(),
                      );
                    return matching.length > 0 ? matching[0] : null;
                  }),
                };
              }
              return {};
            }),
          };
          return cb(manager as unknown as EntityManager);
        },
      );

      // Grant (row 1)
      const row1 = await service.grant(memberId, grantDto);
      expect(row1.is_given).toBe(true);

      // Revoke (row 2)
      const row2 = await service.revoke(memberId, revokeDto);
      expect(row2.is_given).toBe(false);

      // Grant again (row 3)
      const row3 = await service.grant(memberId, grantDto);
      expect(row3.is_given).toBe(true);

      expect(results.length).toBe(3);

      // Simulate getCurrentStatus returning the latest (3rd) row
      mockConsentRepo.findOne.mockResolvedValue(results[2]);
      const status = await service.getCurrentStatus(memberId, ConsentType.GDPR);
      expect(status).toBe(results[2]);
      expect(status!.is_given).toBe(true);
    });

    it('revoke without prior grant throws NotFoundException', async () => {
      mockConsentRepo.findOne.mockResolvedValue(null);
      await expect(service.revoke(memberId, revokeDto)).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // findAll
  // --------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns all consent rows for a member in descending order', async () => {
      const mockRows = [
        { id: 'r1', member_id: memberId, consent_type: ConsentType.GDPR, is_given: true } as MemberConsent,
        { id: 'r2', member_id: memberId, consent_type: ConsentType.GDPR, is_given: false } as MemberConsent,
        { id: 'r3', member_id: memberId, consent_type: ConsentType.MARKETING, is_given: true } as MemberConsent,
      ];
      mockConsentRepo.find.mockResolvedValue(mockRows);

      const result = await service.findAll(memberId);
      expect(result).toHaveLength(3);
      expect(mockConsentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: orgId, member_id: memberId },
          order: { created_at: 'DESC' },
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // getCurrentStatus
  // --------------------------------------------------------------------------

  describe('getCurrentStatus', () => {
    it('returns latest row for (member, consent_type)', async () => {
      const latest = { id: 'r2', consent_type: ConsentType.GDPR, is_given: true } as MemberConsent;
      mockConsentRepo.findOne.mockResolvedValue(latest);

      const result = await service.getCurrentStatus(memberId, ConsentType.GDPR);
      expect(result).toBe(latest);
      expect(mockConsentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: orgId, member_id: memberId, consent_type: ConsentType.GDPR },
          order: { created_at: 'DESC' },
        }),
      );
    });

    it('returns null when no consent record exists', async () => {
      mockConsentRepo.findOne.mockResolvedValue(null);
      const result = await service.getCurrentStatus(memberId, ConsentType.GDPR);
      expect(result).toBeNull();
    });
  });
});