import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxPoller implements OnModuleInit {
  constructor(private readonly outboxService: OutboxService) {}

  async onModuleInit(): Promise<void> {
    // In a production application, this would be triggered by a scheduled job/cron
    // For now, we'll find and process unprocessed events
    const unprocessed = await this.outboxService.findUnprocessedEvents();
    
    for (const event of unprocessed) {
      // Process the event - in a real app, this would publish to RabbitMQ
      console.log(`Processing outbox event: ${event.eventType}, Correlation ID: ${event.correlationId}`);
      
      // Mark as processed after successful processing
      await this.outboxService.markAsProcessed(event.id);
    }
  }
}