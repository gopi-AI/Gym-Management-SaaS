import { Injectable, Logger } from '@nestjs/common';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);

  constructor(private readonly outboxService: OutboxService) {}

  /**
   * Process a batch of pending outbox events.
   *
   * This is intentionally NOT wired to OnModuleInit: processing the outbox as an
   * uncontrolled application-startup task is unsafe (it can block boot, run
   * concurrently across instances, and has no retry/lease semantics). Instead,
   * this method is invoked by a scheduler or dedicated worker (a future scaling
   * step), which controls cadence, concurrency, and backoff.
   *
   * Events are claimed with a lease to prevent duplicate processing, and each
   * event is handled independently so a single failure does not lose the batch.
   *
   * @returns the number of events successfully processed.
   */
  async processPendingEvents(
    workerId: string,
    batchSize = 10,
    lockDurationMs = 30_000,
  ): Promise<number> {
    const events = await this.outboxService.claimNextBatch(
      batchSize,
      lockDurationMs,
      workerId,
    );

    let processed = 0;
    for (const event of events) {
      try {
        // In a real application, this would publish to a broker (e.g. RabbitMQ)
        // using the event envelope. For now we log the dispatch.
        this.logger.log(
          `Processing outbox event: ${event.eventType}, Correlation ID: ${event.correlationId}`,
        );
        await this.outboxService.markAsProcessed(event.id);
        processed++;
      } catch (err) {
        // Do not lose the event: release the lease and increment the attempt
        // counter so it can be retried on a subsequent poll.
        this.logger.error(
          `Failed to process outbox event ${event.id} (${event.eventType})`,
          err instanceof Error ? err.stack : String(err),
        );
        await this.outboxService.markAsFailed(event.id);
      }
    }

    return processed;
  }
}