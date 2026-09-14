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
});