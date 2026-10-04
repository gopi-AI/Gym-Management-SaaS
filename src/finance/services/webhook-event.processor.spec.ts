import { WebhookEventProcessor } from './webhook-event.processor';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Payment } from '../entities/payment.entity';

describe('WebhookEventProcessor', () => {
  const eventId = 'event-row-1';
  // Real UUIDs: DEF-06 rejects a reference the `uuid` column could not address,
  // so a `payment-1` placeholder is no longer a usable fixture id.
  const paymentId = '11111111-1111-4111-8111-111111111111';
  const ORG = 'org-1';
  let event: WebhookEvent;
  let manager: Record<string, any>;
  let dataSource: Record<string, jest.Mock>;
  let paymentOutbox: jest.Mock;
  let payments: { applyGatewayOutcome: jest.Mock };
  let eventRepo: Record<string, jest.Mock>;
  let paymentRepo: Record<string, jest.Mock>;

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
    eventRepo = {
      findOne: jest.fn().mockResolvedValue(event),
      save: jest.fn().mockImplementation(async (value: WebhookEvent) => {
        event = value;
        return value;
      }),
    };
    // Entity-aware, because DEF-04 makes the processor read the PAYMENT row to
    // attribute the event. A blanket `mockReturnValue(eventRepo)` would hand it
    // the webhook row instead and the attribution assertion below would pass
    // against the wrong object.
    paymentRepo = { findOne: jest.fn().mockResolvedValue({ organization_id: ORG }) };
    manager = {
      getRepository: jest.fn((entity: unknown) => (entity === Payment ? paymentRepo : eventRepo)),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (callback: Function) => callback(manager)),
    };
  });

  it('processes duplicate delivery once and emits one payment outbox event', async () => {
    const processor = new WebhookEventProcessor(dataSource as any, payments as any);

    await (processor as any).processOne(eventId);
    eventRepo.findOne.mockResolvedValue(event);
    await (processor as any).processOne(eventId);

    expect(payments.applyGatewayOutcome).toHaveBeenCalledTimes(1);
    expect(paymentOutbox).toHaveBeenCalledTimes(1);
    expect(eventRepo.save).toHaveBeenCalledTimes(1);
    expect(event.status).toBe('processed');
  });

  it('routes payment confirmation through the shared transition that settles the invoice', async () => {
    const processor = new WebhookEventProcessor(dataSource as any, payments as any);

    await (processor as any).processOne(eventId);

    expect(payments.applyGatewayOutcome).toHaveBeenCalledWith(
      manager,
      paymentId,
      expect.objectContaining({ succeeded: true, transactionId: 'pi_1' }),
    );
    expect(paymentOutbox).toHaveBeenCalledTimes(1);
  });

  it('records a charge.refunded event as processed with no state change (DEF-14)', async () => {
    // The shape Stripe actually sends: `data.object` is a Charge, and its metadata
    // is the `{ paymentId }` the adapter set when the PaymentIntent was created —
    // never the Refund's `{ refundId }`. Re-adding `charge.refunded` to the
    // allowlist would therefore route this event down the PAYMENT path and settle
    // the payment the Charge names; this test asserts that does not happen.
    event.event_type = 'charge.refunded';
    (event.payload as any).type = 'charge.refunded';
    (event.payload.data as any).object.metadata = { paymentId };
    const processor = new WebhookEventProcessor(dataSource as any, payments as any);

    await (processor as any).processOne(eventId);

    expect(payments.applyGatewayOutcome).not.toHaveBeenCalled();
    expect(paymentOutbox).not.toHaveBeenCalled();
    expect(paymentRepo.findOne).not.toHaveBeenCalled();
    expect(event.status).toBe('processed');
    expect(event.organization_id).toBeUndefined();
  });

  it('attributes the event to the organization of the payment it names (DEF-04)', async () => {
    const processor = new WebhookEventProcessor(dataSource as any, payments as any);

    await (processor as any).processOne(eventId);

    expect(paymentRepo.findOne).toHaveBeenCalled();
    expect(event.organization_id).toBe(ORG);
  });

  it('applies nothing for an event type outside the allowlist (DEF-06)', async () => {
    event.event_type = 'customer.created';
    (event.payload as any).type = 'customer.created';
    const processor = new WebhookEventProcessor(dataSource as any, payments as any);

    await (processor as any).processOne(eventId);

    expect(payments.applyGatewayOutcome).not.toHaveBeenCalled();
    expect(event.status).toBe('processed');
    expect(event.organization_id).toBeUndefined();
  });

  it('treats a reference that is not a UUID as unreferenced (DEF-06)', async () => {
    (event.payload.data as any).object.metadata = { paymentId: 'not-a-uuid' };
    const processor = new WebhookEventProcessor(dataSource as any, payments as any);

    await (processor as any).processOne(eventId);

    expect(payments.applyGatewayOutcome).not.toHaveBeenCalled();
    expect(paymentRepo.findOne).not.toHaveBeenCalled();
    expect(event.status).toBe('processed');
  });
});