import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxEntity } from './outbox.entity';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEntity)
    private readonly outboxRepository: Repository<OutboxEntity>,
  ) {}

  async findUnprocessedEvents(): Promise<OutboxEntity[]> {
    return this.outboxRepository.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Atomically claim a batch of unprocessed events for a worker.
   * Only events that are not already locked (or whose lock has expired)
   * are claimed, preventing duplicate processing across workers.
   */
  async claimNextBatch(
    limit: number,
    lockDurationMs: number,
    workerId: string,
  ): Promise<OutboxEntity[]> {
    const lockExpiry = new Date(Date.now() + lockDurationMs);
    const now = new Date();

    const candidates = await this.outboxRepository
      .createQueryBuilder('outbox')
      .where('outbox.processed = :processed', { processed: false })
      .andWhere('(outbox.lockedAt IS NULL OR outbox.lockedAt < :now)', { now })
      .orderBy('outbox.createdAt', 'ASC')
      .limit(limit)
      .getMany();

    if (candidates.length === 0) {
      return [];
    }

    const ids = candidates.map((c) => c.id);

    // Claim the events only if they are still unprocessed and unlocked.
    await this.outboxRepository
      .createQueryBuilder()
      .update(OutboxEntity)
      .set({ lockedAt: lockExpiry, lockedBy: workerId })
      .where('id IN (:...ids)', { ids })
      .andWhere('processed = :processed', { processed: false })
      .execute();

    // Re-fetch only the events this worker successfully claimed.
    return this.outboxRepository
      .createQueryBuilder('outbox')
      .where('outbox.id IN (:...ids)', { ids })
      .andWhere('outbox.lockedBy = :workerId', { workerId })
      .getMany();
  }

  async markAsProcessed(id: string): Promise<void> {
    await this.outboxRepository.update(id, {
      processed: true,
      lockedAt: null,
      lockedBy: null,
    });
  }

  async markAsFailed(id: string): Promise<void> {
    await this.outboxRepository
      .createQueryBuilder()
      .update(OutboxEntity)
      .set({
        attempts: () => 'attempts + 1',
        lockedAt: null,
        lockedBy: null,
      })
      .where('id = :id', { id })
      .execute();
  }

  async saveEvent(eventType: string, payload: string, correlationId: string): Promise<OutboxEntity> {
    const event = this.outboxRepository.create({
      eventType,
      payload,
      correlationId,
      processed: false,
    });
    return this.outboxRepository.save(event);
  }
}