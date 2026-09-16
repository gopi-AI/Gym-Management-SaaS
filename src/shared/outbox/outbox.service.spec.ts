import { OutboxService } from './outbox.service';
import { OutboxEntity } from './outbox.entity';
import { EntityManager, Repository } from 'typeorm';

describe('OutboxService — EventEnvelope persistence', () => {
  let service: OutboxService;
  let mockRepo: Record<string, jest.Mock>;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    service = new OutboxService(mockRepo as unknown as Repository<OutboxEntity>);
  });

  describe('saveEventEnvelope', () => {
    it('persists a full EventEnvelope (all contract fields) in the payload column', async () => {
      const created = { id: 'outbox-1', processed: false } as OutboxEntity;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.saveEventEnvelope(
        'MembershipStarted',
        'v1',
        'org-123',
        {
          membershipId: 'm-1',
          memberId: 'mem-1',
          planId: 'p-1',
          startDate: '2026-09-01',
          initialFee: '49.99',
        },
        'corr-1',
      );

      // The entity columns keep eventType + correlationId (denormalized).
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'MembershipStarted',
          correlationId: 'corr-1',
          processed: false,
        }),
      );

      // The payload column must contain the FULL serialized envelope.
      const createCall = mockRepo.create.mock.calls[0][0] as { payload: string };
      const envelope = JSON.parse(createCall.payload) as Record<string, any>;
      expect(typeof envelope.eventId).toBe('string');
      expect(envelope.eventType).toBe('MembershipStarted');
      expect(envelope.eventVersion).toBe('v1');
      expect(envelope.organizationId).toBe('org-123');
      expect(typeof envelope.occurredAt).toBe('string');
      expect(new Date(envelope.occurredAt).toISOString()).toBe(envelope.occurredAt);
      expect(envelope.correlationId).toBe('corr-1');
      // Inner payload preserved.
      expect(envelope.payload).toEqual({
        membershipId: 'm-1',
        memberId: 'mem-1',
        planId: 'p-1',
        startDate: '2026-09-01',
        initialFee: '49.99',
      });
      expect(result).toBe(created);
    });

    it('generates eventId and occurredAt server-side, never from caller input', async () => {
      const created = { id: 'outbox-2' } as OutboxEntity;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.saveEventEnvelope('MembershipStarted', 'v1', 'org-123', {}, 'corr-2');

      const createCall = mockRepo.create.mock.calls[0][0] as { payload: string };
      const envelope = JSON.parse(createCall.payload) as Record<string, any>;
      // eventId and occurredAt are generated inside the service (server-side).
      expect(typeof envelope.eventId).toBe('string');
      expect(new Date(envelope.occurredAt).toISOString()).toBe(envelope.occurredAt);
    });

    it('does not persist a client-controlled organizationId', async () => {
      const created = { id: 'outbox-3' } as OutboxEntity;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      // saveEventEnvelope's signature has NO organizationId input path beyond the
      // explicitly-authorized organizationId parameter.
      await service.saveEventEnvelope('MembershipStarted', 'v1', 'org-123', {}, 'corr-3');

      const createCall = mockRepo.create.mock.calls[0][0] as { payload: string };
      const envelope = JSON.parse(createCall.payload) as Record<string, any>;
      expect(envelope.organizationId).toBe('org-123');
    });
  });

  describe('saveEvent (legacy inner-payload path)', () => {
    it('remains unchanged for existing callers', async () => {
      const created = { id: 'outbox-4' } as OutboxEntity;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.saveEvent('MEMBER_CREATED', '{"memberId":"x"}', 'uuid-1');

      expect(mockRepo.create).toHaveBeenCalledWith({
        eventType: 'MEMBER_CREATED',
        payload: '{"memberId":"x"}',
        correlationId: 'uuid-1',
        processed: false,
      });
      expect(result).toBe(created);
    });
  });

  /**
   * Atomicity regression guard.
   *
   * Domain writes (membership/member + history) and their outbox events MUST use
   * the SAME transaction/connection, otherwise a rolled-back domain write leaves
   * an orphan outbox event committed. Proven at runtime by
   * /tmp/h-atomicity.cjs against a disposable Postgres database; these unit tests
   * pin the mechanism (the caller hands over the open transaction's manager).
   */
  describe('transaction-scoped persistence (atomicity)', () => {
    function txManagerMock() {
      const txRepo = { create: jest.fn(), save: jest.fn() };
      const created = { id: 'outbox-tx' } as OutboxEntity;
      txRepo.create.mockReturnValue(created);
      txRepo.save.mockResolvedValue(created);
      const manager = { getRepository: jest.fn().mockReturnValue(txRepo) };
      return { manager: manager as unknown as EntityManager, txRepo, created };
    }

    it('saveEvent writes through the supplied EntityManager repository only', async () => {
      const { manager, txRepo, created } = txManagerMock();

      const result = await service.saveEvent('MEMBER_CREATED', '{"memberId":"x"}', 'uuid-tx', manager);

      expect((manager as any).getRepository).toHaveBeenCalledWith(OutboxEntity);
      expect(txRepo.create).toHaveBeenCalledWith({
        eventType: 'MEMBER_CREATED',
        payload: '{"memberId":"x"}',
        correlationId: 'uuid-tx',
        processed: false,
      });
      // The ambient (non-transactional) repository must never be used.
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.save).not.toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it('saveEventEnvelope writes through the supplied EntityManager repository only', async () => {
      const { manager, txRepo, created } = txManagerMock();

      const result = await service.saveEventEnvelope(
        'MembershipStarted',
        'v1',
        'org-123',
        { membershipId: 'm-1' },
        'corr-tx',
        undefined,
        manager,
      );

      expect((manager as any).getRepository).toHaveBeenCalledWith(OutboxEntity);
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.save).not.toHaveBeenCalled();
      const createCall = txRepo.create.mock.calls[0][0] as { payload: string };
      expect(JSON.parse(createCall.payload).organizationId).toBe('org-123');
      expect(result).toBe(created);
    });
  });

  describe('claimNextBatch — max-attempts ceiling', () => {
    it('filters out rows that have reached the maxAttempts threshold', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      await service.claimNextBatch(10, 30_000, 'worker-1', 5);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'outbox.attempts < :maxAttempts',
        { maxAttempts: 5 },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'outbox.deadLettered = :deadLettered',
        { deadLettered: false },
      );
    });
  });

  describe('markAsFailed — dead-letter escalation', () => {
    let qb: Record<string, jest.Mock>;

    beforeEach(() => {
      qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);
    });

    it('increments attempts and releases the lock when below maxAttempts', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'outbox-1',
        attempts: 2,
      } as OutboxEntity);

      await service.markAsFailed('outbox-1', 5);

      expect(qb.execute).toHaveBeenCalled();
      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'outbox-1' } });
      // attempts (2) < maxAttempts (5) → NOT dead-lettered
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('marks dead-lettered when attempts >= maxAttempts after increment', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'outbox-1',
        attempts: 5, // post-increment value: 5 >= 5
      } as OutboxEntity);

      await service.markAsFailed('outbox-1', 5);

      expect(mockRepo.update).toHaveBeenCalledWith('outbox-1', {
        processed: true,
        deadLettered: true,
        lockedAt: null,
        lockedBy: null,
      });
    });
  });

  describe('markAsDeadLettered', () => {
    it('sets processed=true, deadLettered=true, and releases lock', async () => {
      mockRepo.update.mockResolvedValue(undefined);

      await service.markAsDeadLettered('outbox-dl');

      expect(mockRepo.update).toHaveBeenCalledWith('outbox-dl', {
        processed: true,
        deadLettered: true,
        lockedAt: null,
        lockedBy: null,
      });
    });
  });
});