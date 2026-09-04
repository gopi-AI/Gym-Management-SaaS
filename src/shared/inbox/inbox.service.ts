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

  async markAsHandled(correlationId: string): Promise<void> {
    await this.inboxRepository.update(correlationId, { handled: true });
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