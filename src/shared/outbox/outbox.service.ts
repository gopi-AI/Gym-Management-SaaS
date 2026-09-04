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

  async markAsProcessed(id: string): Promise<void> {
    await this.outboxRepository.update(id, { processed: true });
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