import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { LoyaltyReadService } from './loyalty-read.service';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

describe('LoyaltyReadService', () => {
  let service!: LoyaltyReadService;
  let mockAccountRepo!: Record<string, jest.Mock>;
  let mockTransactionRepo!: Record<string, jest.Mock>;
  let mockTenantContext!: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const memberId = 'member-1';

  const accountFixture = {
    id: 'acct-1',
    organization_id: orgId,
    member_id: memberId,
    balance: 250,
  } as LoyaltyAccount;

  const transactionsFixture = [
    { id: 'txn-2', account_id: 'acct-1', points: 50, created_at: new Date('2026-10-02') },
    { id: 'txn-1', account_id: 'acct-1', points: 200, created_at: new Date('2026-10-01') },
  ] as LoyaltyTransaction[];

  beforeEach(async () => {
    mockAccountRepo = {
      findOne: jest.fn().mockResolvedValue(accountFixture),
    };

    mockTransactionRepo = {
      find: jest.fn().mockResolvedValue(transactionsFixture),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoyaltyReadService,
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: getRepositoryToken(LoyaltyAccount), useValue: mockAccountRepo },
        { provide: getRepositoryToken(LoyaltyTransaction), useValue: mockTransactionRepo },
      ],
    }).compile();

    service = module.get(LoyaltyReadService);
  });

  describe('findAccountByMemberId', () => {
    it('returns the org-scoped account when found', async () => {
      const result = await service.findAccountByMemberId(memberId);

      expect(mockAccountRepo.findOne).toHaveBeenCalledWith({
        where: { organization_id: orgId, member_id: memberId },
      });
      expect(result).toEqual(accountFixture);
    });

    it('throws NotFoundException when no account exists for that org+member', async () => {
      mockAccountRepo.findOne.mockResolvedValue(null);

      await expect(service.findAccountByMemberId(memberId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockAccountRepo.findOne).toHaveBeenCalledWith({
        where: { organization_id: orgId, member_id: memberId },
      });
    });
  });

  describe('findAllTransactionsByMemberId', () => {
    it('returns transactions ordered DESC by created_at, scoped to the account id', async () => {
      const result = await service.findAllTransactionsByMemberId(memberId);

      expect(mockAccountRepo.findOne).toHaveBeenCalledWith({
        where: { organization_id: orgId, member_id: memberId },
      });
      expect(mockTransactionRepo.find).toHaveBeenCalledWith({
        where: { account_id: accountFixture.id },
        order: { created_at: 'DESC' },
      });
      expect(result).toEqual(transactionsFixture);
    });

    it('throws NotFoundException on its own internal account lookup when the member has no loyalty account', async () => {
      mockAccountRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findAllTransactionsByMemberId(memberId),
      ).rejects.toThrow(NotFoundException);
      expect(mockTransactionRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getOrganizationId fallback chain', () => {
    it('uses getCurrentOrganizationId when present', async () => {
      await service.findAccountByMemberId(memberId);

      expect(mockTenantContext.getCurrentOrganizationId).toHaveBeenCalled();
      expect(mockTenantContext.getRequestedOrganizationId).not.toHaveBeenCalled();
    });

    it('falls back to requireOrganizationAccess(requestedOrgId) when getCurrentOrganizationId returns null', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue('req-org-456');

      const result = await service.findAccountByMemberId(memberId);

      expect(mockTenantContext.requireOrganizationAccess).toHaveBeenCalledWith(
        'req-org-456',
      );
      expect(result).toEqual(accountFixture);
    });

    it('throws NotFoundException when neither resolves', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(null);

      await expect(service.findAccountByMemberId(memberId)).rejects.toThrow(
        'Organization context not found',
      );
      expect(mockAccountRepo.findOne).not.toHaveBeenCalled();
    });
  });
});