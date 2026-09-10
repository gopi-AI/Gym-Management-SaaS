import { InboxService } from './inbox.service';
import { InboxEntity } from './inbox.entity';
import { Repository } from 'typeorm';

describe('InboxService — Idempotency (H1/H7)', () => {
  let service: InboxService;
  let mockRepo: Record<string, jest.Mock>;

  beforeEach(() => {
    mockRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    service = new InboxService(mockRepo as unknown as Repository<InboxEntity>);
  });

  describe('markAsHandled', () => {
    it('uses correlationId (NOT the PK id) as the update criteria', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.markAsHandled('corr-123');

      expect(result).toBe(true);
      // The update criteria MUST be an object keyed on correlationId and guarded on
      // handled=false, NOT the raw correlationId string (which TypeORM would treat as
      // the primary-key id).
      expect(mockRepo.update).toHaveBeenCalledWith(
        { correlationId: 'corr-123', handled: false },
        { handled: true },
      );
    });

    it('returns true on the first (transition) call', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 } as any);
      await expect(service.markAsHandled('corr-123')).resolves.toBe(true);
    });

    it('returns false on a duplicate/concurrent call (already handled)', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 } as any);
      await expect(service.markAsHandled('corr-123')).resolves.toBe(false);
    });

    it('returns false when the correlationId does not exist', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 } as any);
      await expect(service.markAsHandled('does-not-exist')).resolves.toBe(false);
    });
  });

  describe('saveEvent', () => {
    it('returns an existing processed event without inserting a duplicate', async () => {
      const existing = { id: 'e1', correlationId: 'corr-1', handled: true } as InboxEntity;
      mockRepo.findOne.mockResolvedValue(existing);

      const result = await service.saveEvent('corr-1', 'EVENT', '{}');

      expect(result).toBe(existing);
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('creates and saves a new event when none exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const created = { id: 'e2', correlationId: 'corr-2', handled: false } as InboxEntity;
      mockRepo.create.mockReturnValue(created as InboxEntity);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.saveEvent('corr-2', 'EVENT', '{"a":1}');

      expect(mockRepo.create).toHaveBeenCalledWith({
        correlationId: 'corr-2',
        eventType: 'EVENT',
        payload: '{"a":1}',
        handled: false,
      });
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result).toBe(created);
    });
  });
});