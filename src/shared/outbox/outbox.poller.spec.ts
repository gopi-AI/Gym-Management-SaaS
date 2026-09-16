import { OutboxPoller } from './outbox.poller';
import { OutboxService, OutboxEventEnvelope } from './outbox.service';
import { OutboxEntity } from './outbox.entity';
import { EventHandlerRegistry, EventHandler } from '../event-handler/event-handler.registry';

describe('OutboxPoller — dispatch to registered handlers', () => {
  let outboxService: {
    claimNextBatch: jest.Mock;
    markAsProcessed: jest.Mock;
    markAsFailed: jest.Mock;
  };
  let handlerRegistry: EventHandlerRegistry;
  let poller: OutboxPoller;

  const orgId = '00000000-0000-0000-0000-000000000001';

  function makeEnvelope(
    overrides: Partial<OutboxEventEnvelope> = {},
  ): OutboxEventEnvelope {
    return {
      eventId: 'env-1',
      eventType: 'AttendanceEventRecorded',
      eventVersion: 'v1',
      organizationId: orgId,
      occurredAt: '2026-09-16T00:00:00Z',
      correlationId: 'rec-1',
      payload: { memberId: 'm-1', eventType: 'CHECK_IN' },
      ...overrides,
    };
  }

  function makeOutboxRow(
    id: string,
    eventType: string,
    envelope: OutboxEventEnvelope,
  ): OutboxEntity {
    return {
      id,
      eventType,
      payload: JSON.stringify(envelope),
      correlationId: envelope.correlationId,
      processed: false,
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
    } as OutboxEntity;
  }

  beforeEach(() => {
    outboxService = {
      claimNextBatch: jest.fn(),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
      markAsFailed: jest.fn().mockResolvedValue(undefined),
    };
    handlerRegistry = new EventHandlerRegistry();

    poller = new OutboxPoller(
      outboxService as unknown as OutboxService,
      handlerRegistry,
    );
  });

  afterEach(() => {
    handlerRegistry.clear();
  });

  it('calls claimNextBatch with the passed worker/batch/lease args', async () => {
    outboxService.claimNextBatch.mockResolvedValue([]);
    await poller.processPendingEvents('worker-1', 5, 1000);

    expect(outboxService.claimNextBatch).toHaveBeenCalledWith(5, 1000, 'worker-1', OutboxPoller.MAX_ATTEMPTS);
  });

  it('dispatches to the registered handler and marks the event processed', async () => {
    const envelope = makeEnvelope();
    const row = makeOutboxRow('outbox-1', 'AttendanceEventRecorded', envelope);

    const handler: EventHandler = jest.fn().mockResolvedValue(undefined);
    handlerRegistry.register('AttendanceEventRecorded', 'v1', handler);

    outboxService.claimNextBatch.mockResolvedValue([row]);

    const processed = await poller.processPendingEvents('worker-1');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(envelope);
    expect(outboxService.markAsProcessed).toHaveBeenCalledWith('outbox-1');
    expect(outboxService.markAsFailed).not.toHaveBeenCalled();
    expect(processed).toBe(1);
  });

  it('marks events with NO registered handler as processed without error', async () => {
    const envelope = makeEnvelope({
      eventType: 'WorkoutPlanAssigned',
      eventVersion: 'v1',
    });
    const row = makeOutboxRow('outbox-2', 'WorkoutPlanAssigned', envelope);

    outboxService.claimNextBatch.mockResolvedValue([row]);

    const processed = await poller.processPendingEvents('worker-1');

    expect(processed).toBe(1);
    expect(outboxService.markAsProcessed).toHaveBeenCalledWith('outbox-2');
    expect(outboxService.markAsFailed).not.toHaveBeenCalled();
  });

  it('does NOT mark processed when the handler throws; marks failed instead (retry on next poll)', async () => {
    const envelope = makeEnvelope();
    const row = makeOutboxRow('outbox-3', 'AttendanceEventRecorded', envelope);

    const handlerMock = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    handlerRegistry.register('AttendanceEventRecorded', 'v1', handlerMock as EventHandler);

    outboxService.claimNextBatch.mockResolvedValue([row]);

    const processed = await poller.processPendingEvents('worker-1');

    expect(outboxService.markAsProcessed).not.toHaveBeenCalled();
    expect(outboxService.markAsFailed).toHaveBeenCalledWith('outbox-3', OutboxPoller.MAX_ATTEMPTS);
    expect(processed).toBe(0);

    // Retry on next poll once the handler stops failing.
    handlerMock.mockReset();
    handlerMock.mockResolvedValue(undefined);
    outboxService.claimNextBatch.mockResolvedValue([row]);

    const retried = await poller.processPendingEvents('worker-1');
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(outboxService.markAsProcessed).toHaveBeenCalledWith('outbox-3');
    expect(retried).toBe(1);
  });

  it('invokes ALL handlers when multiple are registered for the same type+version', async () => {
    const envelope = makeEnvelope();
    const row = makeOutboxRow('outbox-4', 'AttendanceEventRecorded', envelope);

    const handlerA = jest.fn().mockResolvedValue(undefined) as unknown as EventHandler;
    const handlerB = jest.fn().mockResolvedValue(undefined) as unknown as EventHandler;
    handlerRegistry.register('AttendanceEventRecorded', 'v1', handlerA);
    handlerRegistry.register('AttendanceEventRecorded', 'v1', handlerB);

    outboxService.claimNextBatch.mockResolvedValue([row]);

    await poller.processPendingEvents('worker-1');

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(outboxService.markAsProcessed).toHaveBeenCalledWith('outbox-4');
  });

  it('does NOT mark processed if a later handler throws (event retried on next poll)', async () => {
    const envelope = makeEnvelope();
    const row = makeOutboxRow('outbox-5', 'AttendanceEventRecorded', envelope);

    const okHandler = jest.fn().mockResolvedValue(undefined);
    const failingHandler = jest.fn().mockRejectedValue(new Error('boom'));
    handlerRegistry.register(
      'AttendanceEventRecorded',
      'v1',
      okHandler as unknown as EventHandler,
    );
    handlerRegistry.register(
      'AttendanceEventRecorded',
      'v1',
      failingHandler as unknown as EventHandler,
    );

    outboxService.claimNextBatch.mockResolvedValue([row]);

    await poller.processPendingEvents('worker-1');

    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(outboxService.markAsProcessed).not.toHaveBeenCalled();
    expect(outboxService.markAsFailed).toHaveBeenCalledWith('outbox-5', OutboxPoller.MAX_ATTEMPTS);
  });
it('handles multiple claimed events independently — one failure does not lose the batch', async () => {
    const okEnvelope = makeEnvelope({ eventId: 'env-ok' });
    const badEnvelope = makeEnvelope({ eventId: 'env-bad' });
    const okRow = makeOutboxRow(
      'outbox-ok',
      'AttendanceEventRecorded',
      okEnvelope,
    );
    const badRow = makeOutboxRow(
      'outbox-bad',
      'AttendanceEventRecorded',
      badEnvelope,
    );

    const failingHandler = jest
      .fn()
      .mockRejectedValue(new Error('boom')) as unknown as EventHandler;
    handlerRegistry.register('AttendanceEventRecorded', 'v1', failingHandler);

    outboxService.claimNextBatch.mockResolvedValue([okRow, badRow]);

    const processed = await poller.processPendingEvents('worker-1');

    expect(outboxService.markAsFailed).toHaveBeenCalledWith('outbox-ok', OutboxPoller.MAX_ATTEMPTS);
    expect(outboxService.markAsFailed).toHaveBeenCalledWith('outbox-bad', OutboxPoller.MAX_ATTEMPTS);
    expect(processed).toBe(0);
  });

  it('marks a legacy (non-envelope) payload row as failed, not processed', async () => {
    const row = {
      id: 'outbox-legacy',
      eventType: 'MEMBER_CREATED',
      payload: '{"memberId":"x"}',
      correlationId: 'corr-legacy',
      processed: false,
    } as OutboxEntity;

    outboxService.claimNextBatch.mockResolvedValue([row]);

    const processed = await poller.processPendingEvents('worker-1');

    expect(outboxService.markAsProcessed).not.toHaveBeenCalled();
    expect(outboxService.markAsFailed).toHaveBeenCalledWith('outbox-legacy', OutboxPoller.MAX_ATTEMPTS);
    expect(processed).toBe(0);
  });
});