import { Injectable, Logger } from '@nestjs/common';
import { OutboxService, OutboxEventEnvelope } from './outbox.service';
import { OutboxEntity } from './outbox.entity';
import { EventHandlerRegistry } from '../event-handler/event-handler.registry';

/**
 * How the outbox → consumer dispatch is resolved.
 *
 * The payload column of each outbox row holds a serialized `EventEnvelope` (see
 * `OutboxService.saveEventEnvelope`). The poller parses that envelope, then
 * looks up handlers registered in `EventHandlerRegistry` keyed by
 * `{eventType}.{eventVersion}`.
 *
 * - If NO handler is registered for the event's type+version, the event is
 *   claimed and marked processed without error (nothing is listening — this is the
 *   expected case for events with no consumer, e.g. WorkoutPlanAssigned.v1).
 * - If handler(s) ARE registered, each is invoked in registration order. A single
 *   throw anywhere causes the event to be marked FAILED (attempt count
 *   incremented, lock released) so it is retried on a subsequent poll. The event
 *   is only marked processed after ALL matching handlers succeed.
 */
@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);

  /**
   * Maximum number of attempts before an outbox row is dead-lettered.
   * This is a safety ceiling — rows that fail to parse (legacy payloads) or
   * whose handlers throw repeatedly are excluded from future polls, preventing
   * an infinite retry loop.
   */
  static readonly MAX_ATTEMPTS = 10;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly handlerRegistry: EventHandlerRegistry,
  ) {}

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
      OutboxPoller.MAX_ATTEMPTS,
    );

    let processed = 0;
    for (const event of events) {
      try {
        await this.dispatchEvent(event);
        await this.outboxService.markAsProcessed(event.id);
        processed++;
      } catch (err) {
        // Do not lose the event: release the lease and increment the attempt
        // counter so it can be retried on a subsequent poll.
        this.logger.error(
          `Failed to process outbox event ${event.id} (${event.eventType})`,
          err instanceof Error ? err.stack : String(err),
        );
        await this.outboxService.markAsFailed(event.id, OutboxPoller.MAX_ATTEMPTS);
      }
    }

    return processed;
  }

  /**
   * Route a single outbox event to all registered handlers (if any).
   *
   * Throws if any matching handler throws — the caller then marks the row failed
   * (not processed) so it is retried on the next poll.
   */
  private async dispatchEvent(event: OutboxEntity): Promise<void> {
    const envelope = this.parseEnvelope(event);

    const handlers = this.handlerRegistry.getHandlers(
      envelope.eventType,
      envelope.eventVersion,
    );

    if (handlers.length === 0) {
      // No consumer is listening for this event type/version — this is the
      // expected case (e.g. WorkoutPlanAssigned.v1 has no handler). The event
      // is still marked processed so it doesn't retry forever.
      this.logger.debug(
        `No handler for ${envelope.eventType}.${envelope.eventVersion} (${event.id}) — marking processed`,
      );
      return;
    }

    this.logger.log(
      `Dispatching ${envelope.eventType}.${envelope.eventVersion} to ${handlers.length} handler(s) (${event.id})`,
    );

    for (const handler of handlers) {
      await handler(envelope);
    }
  }

  /**
   * Parse the JSON payload column of an outbox row into an outbox event envelope.
   *
   * @throws if the payload is not valid JSON or does not have the expected
   *   envelope structure (eventType + eventVersion strings).
   */
  private parseEnvelope(event: OutboxEntity): OutboxEventEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.payload);
    } catch (err) {
      const msg =
        `Outbox event ${event.id} (${event.eventType}) has a non-JSON payload column — cannot dispatch. ` +
        `This row may have been written before saveEventEnvelope (legacy inner-payload shape). ` +
        `Marking it failed for manual inspection.`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    const envelope = parsed as OutboxEventEnvelope;
    if (
      typeof envelope.eventType !== 'string' ||
      typeof envelope.eventVersion !== 'string'
    ) {
      const msg =
        `Outbox event ${event.id} payload is not a valid EventEnvelope ` +
        `(missing eventType/eventVersion)`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    return envelope;
  }
}