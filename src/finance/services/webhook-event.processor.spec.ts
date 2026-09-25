import { WebhookEventProcessor } from './webhook-event.processor';
import { WebhookEvent } from '../entities/webhook-event.entity';

describe('WebhookEventProcessor', () => {
  const eventId = 'event-row-1';
  const paymentId = 'payment-1';
  const refundId = 'refund-1';
  let event: WebhookEvent;
  let manager: Record<string, any>;
  let dataSource: Record<string, jest.Mock>;
  let paymentOutbox: jest.Mock;
  let payments: { applyGatewayOutcome: jest.Mock };
  let refunds: { applyGatewayOutcome: jest.Mock };
  let eventRepo: Record<string, jest.Mock>;

  beforeEach(() => {
    event = {
      id: eventId,
      provider: 'stripe',
      provider_event_id: 'evt_duplicate',
      event_type: 'payment_intent.succeeded',
      status: 'processing',
      payload: {
        id: 'evt_duplicate',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', status: 'succeeded', metadata: { paymentId } } },
      },
    } as unknown as WebhookEvent;
    paymentOutbox = jest.fn();
    payments = { applyGatewayOutcome: jest.fn().mockImplementation(async () => paymentOutbox()) };
    refunds = { applyGatewayOutcome: jest.fn() };
    eventRepo = {
      findOne: jest.fn().mockResolvedValue(event),
      save: jest.fn().mockImplementation(async (value: WebhookEvent) => {
        event = value;
        return value;
      }),
    };
    manager = { getRepository: jest.fn().mockReturnValue(eventRepo) };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (callback: Function) => callback(manager)),
    };
  });

  it('processes duplicate delivery once and emits one payment outbox event', async () => {
    const processor = new WebhookEventProcessor(dataSource as any, payments as any, refunds as any);

    await (processor as any).processOne(eventId);
    eventRepo.findOne.mockResolvedValue(event);
    await (processor as any).processOne(eventId);

    expect(payments.applyGatewayOutcome).toHaveBeenCalledTimes(1);
    expect(paymentOutbox).toHaveBeenCalledTimes(1);
    expect(eventRepo.save).toHaveBeenCalledTimes(1);
    expect(event.status).toBe('processed');
  });

  it('routes payment confirmation through the shared transition that settles the invoice', async () => {
    const processor = new WebhookEventProcessor(dataSource as any, payments as any, refunds as any);

    await (processor as any).processOne(eventId);

    expect(payments.applyGatewayOutcome).toHaveBeenCalledWith(
      manager,
      paymentId,
      expect.objectContaining({ succeeded: true, transactionId: 'pi_1' }),
    );
    expect(paymentOutbox).toHaveBeenCalledTimes(1);
  });

  it('routes refund confirmation through the shared locked refund transition', async () => {
    event.event_type = 'charge.refunded';
    (event.payload as any).type = 'charge.refunded';
    (event.payload.data as any).object.metadata = { refundId };
    const processor = new WebhookEventProcessor(dataSource as any, payments as any, refunds as any);

    await (processor as any).processOne(eventId);

    expect(refunds.applyGatewayOutcome).toHaveBeenCalledWith(manager, refundId, {
      succeeded: true,
      gatewayStatus: 'succeeded',
    });
  });
});