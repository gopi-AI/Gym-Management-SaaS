import { EventHandlerRegistry, EventHandler } from './event-handler.registry';
import { OutboxEventEnvelope } from '../outbox/outbox.service';

describe('EventHandlerRegistry', () => {
  let registry: EventHandlerRegistry;
  const handlerA: EventHandler = jest.fn().mockResolvedValue(undefined);
  const handlerB: EventHandler = jest.fn().mockResolvedValue(undefined);
  const envelope: OutboxEventEnvelope = {
    eventId: 'uuid-1',
    eventType: 'AttendanceEventRecorded',
    eventVersion: 'v1',
    organizationId: 'org-1',
    occurredAt: '2026-09-16T00:00:00Z',
    correlationId: 'corr-1',
    payload: { memberId: 'm-1', eventType: 'CHECK_IN' },
  };

  beforeEach(() => {
    registry = new EventHandlerRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('register', () => {
    it('stores a handler keyed by eventType + eventVersion', () => {
      registry.register('AttendanceEventRecorded', 'v1', handlerA);
      expect(registry.hasHandlers('AttendanceEventRecorded', 'v1')).toBe(true);
      expect(registry.hasHandlers('AttendanceEventRecorded', 'v2')).toBe(false);
      expect(registry.hasHandlers('WorkoutPlanAssigned', 'v1')).toBe(false);
    });

    it('supports multiple handlers for the same event type+version (additive)', () => {
      registry.register('AttendanceEventRecorded', 'v1', handlerA);
      registry.register('AttendanceEventRecorded', 'v1', handlerB);

      const handlers = registry.getHandlers('AttendanceEventRecorded', 'v1');
      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toBe(handlerA);
      expect(handlers[1]).toBe(handlerB);
    });

    it('does not collide across different event types with the same name prefix', () => {
      registry.register('AttendanceEventRecorded', 'v1', handlerA);
      registry.register('AttendanceEventRecorded', 'v2', handlerB);

      expect(registry.getHandlers('AttendanceEventRecorded', 'v1')).toEqual([handlerA]);
      expect(registry.getHandlers('AttendanceEventRecorded', 'v2')).toEqual([handlerB]);
    });
  });

  describe('getHandlers / hasHandlers', () => {
    it('returns empty array when no handler is registered', () => {
      expect(registry.getHandlers('Nonexistent', 'v1')).toEqual([]);
      expect(registry.hasHandlers('Nonexistent', 'v1')).toBe(false);
    });

    it('invokes every registered handler in registration order', async () => {
      registry.register('AttendanceEventRecorded', 'v1', handlerA);
      registry.register('AttendanceEventRecorded', 'v1', handlerB);

      for (const handler of registry.getHandlers('AttendanceEventRecorded', 'v1')) {
        await handler(envelope);
      }

      expect(handlerA).toHaveBeenCalledWith(envelope);
      expect(handlerB).toHaveBeenCalledWith(envelope);
      expect((handlerA as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (handlerB as jest.Mock).mock.invocationCallOrder[0],
      );
    });
  });
});
