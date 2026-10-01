import { BadRequestException } from '@nestjs/common';
import { GatewayWebhookService } from './gateway-webhook.service';

/**
 * The gateway webhook is the ONLY unauthenticated, state-changing route in the
 * application (`@Public()`); its whole security model is that an unsigned or
 * tampered payload is rejected before anything is persisted. The scoping plan
 * required an "unsigned/tampered payload" test case; this spec is that case.
 *
 * Stripe is mocked the same way `stripe-payment-gateway.adapter.spec.ts` mocks
 * it: construct with a dummy key, then replace the private client.
 */
describe('GatewayWebhookService', () => {
  const SECRET = 'whsec_test';
  const raw = Buffer.from(
    JSON.stringify({
      id: 'evt_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { paymentId: 'payment-1' } } },
    }),
  );

  function setup(options: { secret?: string; key?: string } = {}) {
    const config = {
      get: jest.fn((name: string, fallback?: unknown) => {
        if (name === 'STRIPE_WEBHOOK_SECRET') return options.secret === undefined ? SECRET : options.secret;
        if (name === 'STRIPE_SECRET_KEY') return options.key === undefined ? 'sk_test_key' : options.key;
        return fallback;
      }),
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const service = new GatewayWebhookService(config as never, repository as never);
    const constructEvent = jest.fn().mockReturnValue(JSON.parse(raw.toString('utf8')));
    // With no key the service constructs no client at all; leave it undefined so the
    // `!this.stripe` guard is the thing under test.
    if (options.key === undefined || options.key) {
      (service as unknown as { stripe: unknown }).stripe = { webhooks: { constructEvent } };
    }
    return { service, repository, constructEvent };
  }

  it('rejects a delivery with no signature header', async () => {
    const { service, repository, constructEvent } = setup();
    await expect(service.receive(raw, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects every delivery when the webhook secret is not configured (fails closed)', async () => {
    const { service, repository, constructEvent } = setup({ secret: '' });
    await expect(service.receive(raw, 't=1,v1=whatever')).rejects.toBeInstanceOf(BadRequestException);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects every delivery when no Stripe client could be constructed', async () => {
    const { service, repository, constructEvent } = setup({ key: '' });
    await expect(service.receive(raw, 't=1,v1=whatever')).rejects.toBeInstanceOf(BadRequestException);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects a tampered payload (the SDK rejects the signature)', async () => {
    const { service, repository, constructEvent } = setup();
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    await expect(service.receive(raw, 't=1,v1=deadbeef')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('verifies the signature over the RAW body and persists the event once', async () => {
    const { service, repository, constructEvent } = setup();
    await expect(service.receive(raw, 't=1,v1=good')).resolves.toEqual({ received: true });

    expect(constructEvent).toHaveBeenCalledWith(raw, 't=1,v1=good', SECRET);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        provider_event_id: 'evt_1',
        event_type: 'payment_intent.succeeded',
        status: 'received',
        payload: expect.objectContaining({ id: 'evt_1' }),
      }),
    );
  });

  it('is idempotent: a duplicate delivery persists nothing and still returns received', async () => {
    const { service, repository } = setup();
    repository.findOne.mockResolvedValue({ id: 'row-1', provider_event_id: 'evt_1' });

    await expect(service.receive(raw, 't=1,v1=good')).resolves.toEqual({ received: true });

    expect(repository.findOne).toHaveBeenCalledWith({ where: { provider_event_id: 'evt_1' } });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
