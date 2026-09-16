import { Global, Module } from '@nestjs/common';
import { EventHandlerRegistry } from './event-handler.registry';

/**
 * Shared event-handler infrastructure.
 *
 * @Global-scoped so that any module (loyalty, future notification module, etc.)
 * can inject `EventHandlerRegistry` and register its consumers without each
 * module having to import this module individually.
 *
 * The registry is the transitional in-process delivery mechanism for outbox
 * events. See `EventHandlerRegistry` docs for the design rationale and the
 * eventual RabbitMQ target.
 */
@Global()
@Module({
  providers: [EventHandlerRegistry],
  exports: [EventHandlerRegistry],
})
export class EventHandlerModule {}