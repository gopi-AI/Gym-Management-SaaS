import { Injectable, Logger } from '@nestjs/common';
import { OutboxEventEnvelope } from '../outbox/outbox.service';

/**
 * A consumer handler function registered for a specific event type+version.
 *
 * Handlers receive the full, parsed event envelope (the serialized payload
 * column of the outbox row — see `OutboxEventEnvelope`). They are expected to
 * either complete successfully or throw; if a handler throws, the outbox row is
 * NOT marked processed and will be retried on a subsequent poll.
 */
export type EventHandler = (envelope: OutboxEventEnvelope) => Promise<void>;

/** Registry key: `{eventType}.{eventVersion}`, e.g. `AttendanceEventRecorded.v1`. */
export type EventHandlerKey = string;

/**
 * In-process event routing registry.
 *
 * This is the transitional delivery mechanism that closes the outbox-to-consumer
 * dispatch gap WITHOUT a message broker. Consumer modules register a handler
 * function (keyed by `eventType` + `eventVersion`) at module init; the
 * `OutboxPoller` looks up matching handlers for each claimed outbox row and
 * invokes them.
 *
 * Multiple handlers MAY be registered for the same event type+version — all are
 * invoked (in registration order) when the event is dispatched. This is by
 * design: it mirrors the eventual broker topology where multiple consumer
 * queues bind to the same exchange with the same routing key.
 *
 * The eventual target per `docs/event-contracts.md` is RabbitMQ (topic
 * exchange `gym-management.events`, routing key `org.{orgId}.{eventName}.{ver}`
 * with per-service queues, inbox-based idempotency, and DLQ with retries). That
 * infrastructure is deliberately NOT built here (single live consumer today);
 * this registry is the drop-in in-process stand-in that preserves the same
 * routing semantics (type+version) so that a future RabbitMQ integration can
 * replace `OutboxPoller`'s dispatch step without changing what consumers
 * register.
 */
@Injectable()
export class EventHandlerRegistry {
  private readonly logger = new Logger(EventHandlerRegistry.name);
  private readonly handlers = new Map<EventHandlerKey, EventHandler[]>();

  /**
   * Register a handler for a specific event type + version.
   *
   * Registrations are additive: if another module already registered a handler
   * for the same key, the new handler is appended (both will fire on dispatch).
   *
   * @param eventType  The `eventType` from the event envelope (e.g. 'AttendanceEventRecorded').
   * @param eventVersion The `eventVersion` from the event envelope (e.g. 'v1').
   * @param handler    The handler function. Must resolve on success or throw on failure.
   */
  register(eventType: string, eventVersion: string, handler: EventHandler): void {
    const key = this.makeKey(eventType, eventVersion);
    const existing = this.handlers.get(key) ?? [];
    existing.push(handler);
    this.handlers.set(key, existing);
    this.logger.debug(
      `Registered handler for ${eventType}.${eventVersion} (${existing.length} total)` ,
    );
  }

  /**
   * Return all handlers registered for an event type+version, in registration order.
   * Returns an empty array when no handlers are registered.
   */
  getHandlers(eventType: string, eventVersion: string): EventHandler[] {
    return this.handlers.get(this.makeKey(eventType, eventVersion)) ?? [];
  }

  /** True when at least one handler is registered for the key. */
  hasHandlers(eventType: string, eventVersion: string): boolean {
    return this.getHandlers(eventType, eventVersion).length > 0;
  }

  /** Remove all handlers (used by tests to isolate registrations). */
  clear(): void {
    this.handlers.clear();
  }

  private makeKey(eventType: string, eventVersion: string): EventHandlerKey {
    return `${eventType}.${eventVersion}`;
  }
}
