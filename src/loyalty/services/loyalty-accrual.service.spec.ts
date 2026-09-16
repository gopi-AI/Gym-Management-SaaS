import { Test } from '@nestjs/testing';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { LoyaltyAccrualService, CheckInEventInput, WorkoutLoggedEventInput } from './loyalty-accrual.service';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyRule } from '../entities/loyalty-rule.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { OutboxService } from '../../shared/outbox/outbox.service';

describe('LoyaltyAccrualService', () => {
  let service: LoyaltyAccrualService;
  let ruleRepo: Record<string, jest.Mock>;
  let orgRepo: Record<string, jest.Mock>;
  let txnRepo: Record<string, jest.Mock>;
  let accountRepo: Record<string, jest.Mock>;
  let outboxService: Record<string, jest.Mock>;
  let mockManager: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock };

  const orgId = '00000000-0000-0000-0000-000000000001';
  const memberId = '00000000-0000-0000-0000-000000000002';
  const accountId = '00000000-0000-0000-0000-000000000003';

  const accountEntity = {
    id: accountId,
    organization_id: orgId,
    member_id: memberId,
    balance: 0,
    lifetime_points_earned: 0,
    lifetime_points_redeemed: 0,
    tier: null,
  } as LoyaltyAccount;

  const ruleEntity = {
    id: 'rule-1',
    organization_id: orgId,
    name: 'Check-in earn',
    trigger_event: 'check_in',
    points_per_event: 10,
    max_per_day: 1,
    is_active: true,
  } as LoyaltyRule;

  const orgEntity = {
    id: orgId,
    name: 'Test Org',
    points_expiry_days: 365,
  } as Organization;

  const savedTxn = {
    id: 'txn-1',
    account_id: accountId,
    transaction_type: 'earn',
    points: 10,
    remaining_points: 10,
  } as LoyaltyTransaction;

  beforeEach(() => {
    ruleRepo = { findOne: jest.fn() };
    orgRepo = { findOne: jest.fn() };
    txnRepo = { create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    accountRepo = { create: jest.fn(), save: jest.fn(), findOne: jest.fn(), increment: jest.fn() };
    outboxService = { saveEventEnvelope: jest.fn().mockResolvedValue({ id: 'outbox-1' }) };

    mockManager = { getRepository: jest.fn() };
    mockManager.getRepository.mockImplementation((entity: any) => {
      if (entity === Organization) return orgRepo;
      if (entity === LoyaltyAccount) return accountRepo;
      return txnRepo;
    });

    dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => Promise<any>) => cb(mockManager as unknown as EntityManager)),
    };

    const mockQueryBuilder = () => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });
    txnRepo.createQueryBuilder.mockImplementation(() => mockQueryBuilder());

    service = new LoyaltyAccrualService(
      accountRepo as unknown as Repository<LoyaltyAccount>,
      txnRepo as unknown as Repository<LoyaltyTransaction>,
      ruleRepo as unknown as Repository<LoyaltyRule>,
      orgRepo as unknown as Repository<Organization>,
      dataSource as unknown as DataSource,
      outboxService as unknown as OutboxService,
    );
  });

  describe('handleCheckIn', () => {
    it('ignores non-CHECK_IN events', async () => {
      const result = await service.handleCheckIn({ organizationId: orgId, memberId, eventType: 'CHECK_OUT' });
      expect(result.awarded).toBe(false);
      expect(ruleRepo.findOne).not.toHaveBeenCalled();
    });

    it('no-ops when no active rule', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      const result = await service.handleCheckIn({ organizationId: orgId, memberId, eventType: 'CHECK_IN' });
      expect(result.awarded).toBe(false);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('creates an account on first earn and awards points + emits envelope', async () => {
      ruleRepo.findOne.mockResolvedValue(ruleEntity);
      orgRepo.findOne.mockResolvedValue(orgEntity);
      accountRepo.findOne.mockResolvedValue(null);
      accountRepo.create.mockReturnValue(accountEntity);
      accountRepo.save.mockResolvedValue(accountEntity);
      txnRepo.create.mockReturnValue(savedTxn);
      txnRepo.save.mockResolvedValue(savedTxn);

      const result = await service.handleCheckIn({
        organizationId: orgId, memberId, eventType: 'CHECK_IN', eventId: 'event-1',
      });
      expect(result.awarded).toBe(true);
      expect(result.points).toBe(10);
      expect(accountRepo.create).toHaveBeenCalled();
      expect(txnRepo.create).toHaveBeenCalledWith(expect.objectContaining({ reference_id: 'event-1' }));
      expect(accountRepo.increment).toHaveBeenCalledWith({ id: accountId }, 'balance', 10);
      expect(outboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'LoyaltyPointsAwarded', 'v1', orgId,
        expect.objectContaining({ accountId, memberId, points: 10 }),
        expect.any(String), undefined, expect.anything(),
      );
    });

    it('reuses existing account', async () => {
      ruleRepo.findOne.mockResolvedValue(ruleEntity);
      orgRepo.findOne.mockResolvedValue(orgEntity);
      accountRepo.findOne.mockResolvedValue(accountEntity);
      txnRepo.create.mockReturnValue(savedTxn);
      txnRepo.save.mockResolvedValue(savedTxn);

      await service.handleCheckIn({ organizationId: orgId, memberId, eventType: 'CHECK_IN' });
      expect(accountRepo.create).not.toHaveBeenCalled();
      expect(accountRepo.increment).toHaveBeenCalled();
    });

    it('catches and returns accrual error on failure', async () => {
      ruleRepo.findOne.mockResolvedValue(ruleEntity);
      accountRepo.findOne.mockResolvedValue(accountEntity);
      // No txnRepo.createQueryBuilder mock => reachedDailyCap throws.
      const result = await service.handleCheckIn({ organizationId: orgId, memberId, eventType: 'CHECK_IN' });
      expect(result.awarded).toBe(false);
      expect(result.reason).toContain('Accrual error');
    });
  });

  describe('handleWorkoutLogged', () => {
    it('exists and is safe (no workout_logged producer in Phase 2)', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      const result = await service.handleWorkoutLogged({
        organizationId: orgId, memberId, sessionId: 'session-1',
      });
      expect(result.awarded).toBe(false);
      expect(ruleRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ trigger_event: 'workout_logged' }) }),
      );
    });
  });
});
