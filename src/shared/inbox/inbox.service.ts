import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxEntity } from './inbox.entity';

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(InboxEntity)
    private readonly inboxRepository: Repository<InboxEntity>,
  ) {}

  async findProcessedEvent(correlationId: string): Promise<InboxEntity | null> {
    return this.inboxRepository.findOne({
      where: { correlationId, handled: true },
    });
  }

  /**
   * Idempotently mark an inbox event as handled.
   *
   * The update criteria uses the business-unique `correlationId` (NOT the primary
   * key `id`) and additionally guards on `handled = false` so that concurrent or
   * duplicate deliveries of the same event are safe: the first caller flips the
   * flag (affected === 1) and every later caller observes affected === 0 and
   * returns `false` without error.
   *
   * Returns `true` when the event was transitioned unhandled -> handled by THIS
   * call, or `false` when the event was already handled (or does not exist).
   */
  async markAsHandled(correlationId: string): Promise<boolean> {
    const result = await this.inboxRepository.update(
      { correlationId, handled: false },
      { handled: true },
    );
    return (result.affected ?? 0) > 0;
  }

  async saveEvent(correlationId: string, eventType: string, payload: string): Promise<InboxEntity> {
    const exists = await this.findProcessedEvent(correlationId);
    if (exists) {
      return exists;
    }
    const event = this.inboxRepository.create({
      correlationId,
      eventType,
      payload,
      handled: false,
    });
    return this.inboxRepository.save(event);
  }
}