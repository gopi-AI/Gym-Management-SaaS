import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoyaltyAdjustService } from './loyalty-adjust.service';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

describe('LoyaltyAdjustService', () => {
  let service!: LoyaltyAdjustService;
  let mockAccountRepo!: Record<string, jest.Mock>;
  let mockTransactionRepo!: Record<string, jest.Mock>;
  let mockDataSource!: { transaction: jest.Mock };
  let mockTenantContext!: Record<string, jest.Mock>;
  let mockOutboxService!: Record<string, jest.Mock>;
  let manager!: { getRepository: jest.Mock };

  const orgId = 'org-1';
  const otherOrgId = 'org-2';
  const memberId = 'member-1';
  const actorId = 'user-9';

  const account = {
    id: 'acct-1',
    organization_id: orgId,
    member_id: memberId,
    balance: 100,
    lifetime_points_earned: 100,
    lifetime_points_redeemed: 0,
  } as LoyaltyAccount;

  const savedTransaction = {
    id: 'txn-1',
    account_id: account.id,
    transaction_type: 'adjust',
    points: 50,
    remaining_points: 50,
  } as LoyaltyTransaction;

  const dto = {
    points: 50,
    reason: 'Goodwill credit',
    idempotency_key: 'idem-1',
  };

  beforeEach(async () => {
    mockAccountRepo = {
      findOne: jest.fn().mockResolvedValue(account),
      increment: jest.fn().mockResolvedValue(undefined),
      decrement: jest.fn().mockResolvedValue(undefined),
    };
    mockTransactionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((value) => ({ ...savedTransaction, ...value })),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    };
    manager = {
      getRepository: jest.fn().mockImplementation((target: unknown) => {
        if (target === LoyaltyAccount) return mockAccountRepo;
        if (target === LoyaltyTransaction) return mockTransactionRepo;
        throw new Error('unexpected repository');
      }),
    };
    mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation(async (cb: (mgr: EntityManager) => unknown) =>
          cb(manager as unknown as EntityManager),
        ),
    };
    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
    };
    mockOutboxService = {
      saveEventEnvelope: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoyaltyAdjustService,
        { provide: getRepositoryToken(LoyaltyAccount), useValue: mockAccountRepo },
        { provide: getRepositoryToken(LoyaltyTransaction), useValue: mockTransactionRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
      ],
    }).compile();

    service = module.get(LoyaltyAdjustService);
  });

  it('locks the org-scoped account row before doing anything else', async () => {
    await service.adjust(memberId, dto, actorId);

    expect(mockAccountRepo.findOne).toHaveBeenCalledWith({
      where: { organization_id: orgId, member_id: memberId },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('applies a positive adjustment as an append-only adjust row and increments the balance', async () => {
    const result = await service.adjust(memberId, dto, actorId);

    expect(mockTransactionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: account.id,
        transaction_type: 'adjust',
        points: 50,
        remaining_points: 50,
        reference_type: 'admin_adjust',
        reference_id: 'idem-1',
        description: 'Goodwill credit',
        expires_at: null,
        created_by: actorId,
      }),
    );
    expect(mockAccountRepo.increment).toHaveBeenCalledWith(
      { id: account.id, organization_id: orgId },
      'balance',
      50,
    );
    expect(mockAccountRepo.decrement).not.toHaveBeenCalled();

    // Lifetime counters track trigger-based earn and reward redemption only;
    // an adjustment must not touch them. The only increment is `balance`.
    expect(mockAccountRepo.increment).toHaveBeenCalledTimes(1);
    expect(mockAccountRepo.increment.mock.calls[0][1]).toBe('balance');
    expect(mockAccountRepo.decrement).toHaveBeenCalledTimes(0);

    expect(result).toEqual({
      transaction: expect.objectContaining({ id: 'txn-1' }),
      balance: 150,
      created: true,
    });
  });

  it('emits LoyaltyPointsAdjusted.v1 on the transaction manager, not the ambient repository', async () => {
    await service.adjust(memberId, dto, actorId);

    expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
      'LoyaltyPointsAdjusted',
      'v1',
      orgId,
      expect.objectContaining({
        accountId: account.id,
        memberId,
        transactionId: 'txn-1',
        points: 50,
        balanceAfter: 150,
        reason: 'Goodwill credit',
        adjustedBy: actorId,
      }),
      'txn-1',
      undefined,
      manager,
    );
  });

  it('applies a negative adjustment as a decrement with remaining_points 0', async () => {
    const result = await service.adjust(
      memberId,
      { points: -40, reason: 'Correction', idempotency_key: 'idem-2' },
      actorId,
    );

    expect(mockTransactionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_type: 'adjust',
        points: 40,
        remaining_points: 0,
        reference_id: 'idem-2',
      }),
    );
    expect(mockAccountRepo.decrement).toHaveBeenCalledWith(
      { id: account.id, organization_id: orgId },
      'balance',
      40,
    );
    expect(mockAccountRepo.increment).not.toHaveBeenCalled();
    expect(result.balance).toBe(60);
  });

  it('rejects a debit that would take the balance below zero, with no write', async () => {
    await expect(
      service.adjust(
        memberId,
        { points: -101, reason: 'Too much', idempotency_key: 'idem-3' },
        actorId,
      ),
    ).rejects.toThrow(ConflictException);

    expect(mockTransactionRepo.create).not.toHaveBeenCalled();
    expect(mockTransactionRepo.save).not.toHaveBeenCalled();
    expect(mockAccountRepo.decrement).not.toHaveBeenCalled();
    expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
  });

  it('allows a debit that lands exactly on zero', async () => {
    const result = await service.adjust(
      memberId,
      { points: -100, reason: 'Full debit', idempotency_key: 'idem-4' },
      actorId,
    );

    expect(mockAccountRepo.decrement).toHaveBeenCalledWith(
      { id: account.id, organization_id: orgId },
      'balance',
      100,
    );
    expect(result.balance).toBe(0);
  });

  it('replays an existing transaction for the same idempotency key without writing', async () => {
    const existing = { id: 'txn-existing', reference_id: 'idem-1' } as LoyaltyTransaction;
    mockTransactionRepo.findOne.mockResolvedValue(existing);

    const result = await service.adjust(memberId, dto, actorId);

    expect(result).toEqual({
      transaction: existing,
      balance: 100,
      created: false,
    });
    expect(mockTransactionRepo.create).not.toHaveBeenCalled();
    expect(mockTransactionRepo.save).not.toHaveBeenCalled();
    expect(mockAccountRepo.increment).not.toHaveBeenCalled();
    expect(mockAccountRepo.decrement).not.toHaveBeenCalled();
    expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
  });

  it('looks the replay key up scoped to the account and the admin_adjust reference type', async () => {
    await service.adjust(memberId, dto, actorId);

    expect(mockTransactionRepo.findOne).toHaveBeenCalledWith({
      where: {
        account_id: account.id,
        reference_type: 'admin_adjust',
        reference_id: 'idem-1',
      },
    });
  });

  it('404s when the member has no loyalty account in the caller org', async () => {
    mockAccountRepo.findOne.mockResolvedValue(null);

    await expect(service.adjust(memberId, dto, actorId)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockTransactionRepo.findOne).not.toHaveBeenCalled();
  });

  it('scopes the account lookup to the caller org (cross-org member is a 404)', async () => {
    mockTenantContext.getCurrentOrganizationId.mockResolvedValue(otherOrgId);
    mockAccountRepo.findOne.mockResolvedValue(null);

    await expect(service.adjust(memberId, dto, actorId)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockAccountRepo.findOne).toHaveBeenCalledWith({
      where: { organization_id: otherOrgId, member_id: memberId },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('resolves the org through requireOrganizationAccess when no current org is set', async () => {
    mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
    mockTenantContext.getRequestedOrganizationId.mockResolvedValue('req-org');
    mockTenantContext.requireOrganizationAccess.mockResolvedValue('req-org');

    await service.adjust(memberId, dto, actorId);

    expect(mockTenantContext.requireOrganizationAccess).toHaveBeenCalledWith('req-org');
    expect(mockAccountRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization_id: 'req-org', member_id: memberId },
      }),
    );
  });
});
