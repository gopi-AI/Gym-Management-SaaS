import { Repository, DataSource, EntityManager } from 'typeorm';
import { OutboxPoller } from '../../shared/outbox/outbox.poller';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { EventHandlerRegistry } from '../../shared/event-handler/event-handler.registry';
import { LoyaltyAccrualService } from './loyalty-accrual.service';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyRule } from '../entities/loyalty-rule.entity';
import { Organization } from '../../tenancy/entities/organization.entity';

/**
 * Integration-level proof: an outbox event → poller dispatch → loyalty accrual.
 *
 * ⚠️ This test exercises the full wiring (poller → registry → handler → service)
 *    against mocked TypeORM repositories — it does NOT run against a real Postgres
 *    database. A true DB-backed E2E test covering INSERT → poll → assert persisted
 *    LOYALTY_TRANSACTIONS row does not exist yet and is tracked as a separate follow-up.
 *
 * Before this wiring was built, this test could NOT have passed — the poller only
 * logged and marked processed. No consumer ever fired.
 */
describe('Integration: Outbox → Poller → Loyalty Accrual', () => {
  let poller: OutboxPoller;
  let outboxService: OutboxService;
  let handlerRegistry: EventHandlerRegistry;
  let accrualService: LoyaltyAccrualService;

  let ruleRepo: Record<string, jest.Mock>;
  let orgRepo: Record<string, jest.Mock>;
  let txnRepo: Record<string, jest.Mock>;
  let accountRepo: Record<string, jest.Mock>;
  let outboxRepo: Record<string, jest.Mock>;
  let mockManager: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock };

  const orgId = '00000000-0000-0000-0000-000000000001';
  const memberId = '00000000-0000-0000-0000-000000000002';
  const accountId = '00000000-0000-0000-0000-000000000003';
  const attendanceEventId = 'attendance-event-1';

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
    // --- Mock repositories ---
    ruleRepo = { findOne: jest.fn() };
    orgRepo = { findOne: jest.fn() };
    txnRepo = {
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    accountRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      increment: jest.fn(),
    };
    outboxRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    // --- EntityManager mock (routed to the correct repo per entity) ---
    mockManager = { getRepository: jest.fn() };
    mockManager.getRepository.mockImplementation((entity: any) => {
      if (entity === Organization) return orgRepo;
      if (entity === LoyaltyAccount) return accountRepo;
      if (entity === LoyaltyTransaction) return txnRepo;
      if (entity === LoyaltyRule) return ruleRepo;
      return txnRepo;
    });

    // --- DataSource (wraps a callback in our mock manager) ---
    dataSource = {
      transaction: jest.fn(
        async (cb: (m: EntityManager) => Promise<any>) =>
          cb(mockManager as unknown as EntityManager),
      ),
    };

    // --- Daily cap query builder ---
    const mockQueryBuilder = () => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });
    txnRepo.createQueryBuilder.mockImplementation(() => mockQueryBuilder());

    // --- LoyaltyAccrualService (the real consumer) ---
    accrualService = new LoyaltyAccrualService(
      accountRepo as unknown as Repository<LoyaltyAccount>,
      txnRepo as unknown as Repository<LoyaltyTransaction>,
      ruleRepo as unknown as Repository<LoyaltyRule>,
      orgRepo as unknown as Repository<Organization>,
      dataSource as unknown as DataSource,
      {
        saveEventEnvelope: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      } as unknown as OutboxService,
    );

    // --- EventHandlerRegistry (the router) ---
    handlerRegistry = new EventHandlerRegistry();

    // --- OutboxService (the event store) ---
    outboxService = new OutboxService(
      outboxRepo as unknown as Repository<OutboxEntity>,
    );

    // --- OutboxPoller (the dispatcher) ---
    poller = new OutboxPoller(outboxService, handlerRegistry);
  });

  afterEach(() => {
    handlerRegistry.clear();
  });
it('proves that a CHECK_IN event in the outbox actually creates a LoyaltyTransaction and increments balance', async () => {
    // Register the loyalty handler (as LoyaltyModule.onModuleInit does).
    handlerRegistry.register('AttendanceEventRecorded', 'v1', async (envelope) => {
      const payload = envelope.payload as Record<string, unknown>;
      await accrualService.handleCheckIn({
        organizationId: envelope.organizationId,
        memberId: payload.memberId as string,
        eventType: payload.eventType as string,
        eventId: payload.eventId as string,
        attendanceRecordId: envelope.correlationId,
        eventTime: payload.eventTime as string,
      });
    });

    // Simulate an outbox row written by the Attendance module.
    const outboxRow = {
      id: 'outbox-int-1',
      eventType: 'AttendanceEventRecorded',
      payload: JSON.stringify({
        eventId: attendanceEventId,
        eventType: 'AttendanceEventRecorded',
        eventVersion: 'v1',
        organizationId: orgId,
        occurredAt: '2026-09-16T10:00:00.000Z',
        correlationId: 'rec-123',
        payload: {
          eventId: attendanceEventId,
          deviceId: null,
          memberId,
          eventTime: '2026-09-16T10:00:00.000Z',
          eventType: 'CHECK_IN',
          biometricId: null,
          checkedInBy: 'user-1',
          checkInMethod: 'MANUAL',
        },
      }),
      correlationId: 'rec-123',
      processed: false,
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
    } as OutboxEntity;

    // Mock the persistence chain.
    ruleRepo.findOne.mockResolvedValue(ruleEntity);
    orgRepo.findOne.mockResolvedValue(orgEntity);
    accountRepo.findOne.mockResolvedValue(null); // → getOrCreateAccount creates it
    accountRepo.create.mockReturnValue(accountEntity);
    accountRepo.save.mockResolvedValue(accountEntity);
    txnRepo.create.mockReturnValue(savedTxn);
    txnRepo.save.mockResolvedValue(savedTxn);

    // Mock claimNextBatch's query builder (OutboxService.claimNextBatch).
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([outboxRow]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    outboxRepo.createQueryBuilder.mockImplementation(() => qb);

    // Run the poller.
    const processed = await poller.processPendingEvents('worker-int');

    // The event was processed.
    expect(processed).toBe(1);

    // Loyalty accrual happened: rule found, account created, txn created, balance incremented.
    expect(txnRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: accountId,
        transaction_type: 'earn',
        points: 10,
      }),
    );
    expect(accountRepo.increment).toHaveBeenCalledWith(
      { id: accountId },
      'balance',
      10,
    );
    expect(accountRepo.increment).toHaveBeenCalledWith(
      { id: accountId },
      'lifetime_points_earned',
      10,
    );
  });
it('proves retry-on-failure: a handler throw does NOT mark the event processed, and subsequent poll succeeds', async () => {
    // Register a handler that fails the first time, succeeds the second.
    let callCount = 0;
    handlerRegistry.register('AttendanceEventRecorded', 'v1', async (envelope) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Transient failure');
      }
      // On the second call, succeed using the real accrual service.
      const payload = envelope.payload as Record<string, unknown>;
      await accrualService.handleCheckIn({
        organizationId: envelope.organizationId,
        memberId: payload.memberId as string,
        eventType: payload.eventType as string,
        eventId: payload.eventId as string,
        attendanceRecordId: envelope.correlationId,
        eventTime: payload.eventTime as string,
      });
    });

    const outboxRow = {
      id: 'outbox-int-2',
      eventType: 'AttendanceEventRecorded',
      payload: JSON.stringify({
        eventId: attendanceEventId,
        eventType: 'AttendanceEventRecorded',
        eventVersion: 'v1',
        organizationId: orgId,
        occurredAt: '2026-09-16T10:00:00.000Z',
        correlationId: 'rec-456',
        payload: {
          eventId: attendanceEventId,
          deviceId: null,
          memberId,
          eventTime: '2026-09-16T10:00:00.000Z',
          eventType: 'CHECK_IN',
          biometricId: null,
          checkedInBy: 'user-1',
          checkInMethod: 'MANUAL',
        },
      }),
      correlationId: 'rec-456',
      processed: false,
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
    } as OutboxEntity;

    // Configure success mocks for the retry attempt.
    ruleRepo.findOne.mockResolvedValue(ruleEntity);
    orgRepo.findOne.mockResolvedValue(orgEntity);
    accountRepo.findOne.mockResolvedValue(accountEntity); // Already exists
    txnRepo.create.mockReturnValue(savedTxn);
    txnRepo.save.mockResolvedValue(savedTxn);

    // First poll: handler throws.
    const qbFail = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([outboxRow]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    outboxRepo.createQueryBuilder.mockImplementation(() => qbFail);

    const processed1 = await poller.processPendingEvents('worker-int');

    // Assert: NOT processed (marked failed, not processed).
    expect(processed1).toBe(0);
    const markedProcessedFail = (outboxRepo.update as jest.Mock).mock.calls.some(
      (c: [string, unknown]) =>
        c[0] === 'outbox-int-2' &&
        (c[1] as { processed?: boolean }).processed === true,
    );
    expect(markedProcessedFail).toBe(false);

    // Second poll: handler succeeds.
    // Reset the query builder mock so it returns the row again.
    (outboxRepo.update as jest.Mock).mockClear();
    const qbSuccess = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([outboxRow]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    outboxRepo.createQueryBuilder.mockImplementation(() => qbSuccess);

    const processed2 = await poller.processPendingEvents('worker-int');

    // Assert: processed this time.
    expect(processed2).toBe(1);
    const markedProcessedSuccess = (outboxRepo.update as jest.Mock).mock.calls.some(
      (c: [string, unknown]) =>
        c[0] === 'outbox-int-2' &&
        (c[1] as { processed?: boolean }).processed === true,
    );
    expect(markedProcessedSuccess).toBe(true);

    // Loyalty accrual happened on the retry.
    expect(accountRepo.increment).toHaveBeenCalled();
  });
});
