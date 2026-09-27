import { StripePaymentGatewayAdapter } from './stripe-payment-gateway.adapter';

describe('StripePaymentGatewayAdapter', () => {
  const payment = { id: 'payment-1', amount: '12.34', idempotency_key: 'payment-key' } as any;
  const refund = { id: 'refund-1', payment_id: 'payment-1', amount: '3.00', idempotency_key: 'refund-key' } as any;

  function adapter() {
    const instance = new StripePaymentGatewayAdapter({ get: jest.fn().mockReturnValue('sk_test_key') } as any);
    const stripe = {
      paymentIntents: { create: jest.fn().mockResolvedValue({ id: 'pi_1', status: 'succeeded' }) },
      refunds: { create: jest.fn().mockResolvedValue({ id: 're_1', status: 'succeeded' }) },
    };
    (instance as any).stripe = stripe;
    return { instance, stripe };
  }

  it('charges through Stripe with its idempotency key', async () => {
    const { instance, stripe } = adapter();
    await expect(instance.charge(payment)).resolves.toMatchObject({ succeeded: true, transactionId: 'pi_1' });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1234, metadata: { paymentId: 'payment-1' } }),
      { idempotencyKey: 'payment-key' },
    );
  });

  it('charges a saved method with the Stripe customer and off-session confirmation', async () => {
    const { instance, stripe } = adapter();
    await instance.charge(payment, {
      stripe_customer_id: 'cus_1',
      stripe_payment_method_id: 'pm_1',
    } as any);
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', payment_method: 'pm_1', off_session: true, confirm: true }),
      { idempotencyKey: 'payment-key' },
    );
  });

  it('delegates attempt to charge', async () => {
    const { instance } = adapter();
    const charge = jest.spyOn(instance, 'charge').mockResolvedValue({ succeeded: true, transactionId: 'pi_1' });
    await expect(instance.attempt(payment)).resolves.toEqual({ succeeded: true, transactionId: 'pi_1' });
    expect(charge).toHaveBeenCalledWith(payment);
  });

  it('refunds through Stripe with its idempotency key', async () => {
    const { instance, stripe } = adapter();
    await expect(instance.refund(refund)).resolves.toMatchObject({ succeeded: true, transactionId: 're_1' });
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 300, metadata: { refundId: 'refund-1' } }),
      { idempotencyKey: 'refund-key' },
    );
  });
});