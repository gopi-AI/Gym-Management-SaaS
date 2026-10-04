import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Payment } from '../entities/payment.entity';
import { Refund } from '../entities/refund.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { PaymentAttemptOutcome, PaymentGatewayPort } from './payment-gateway.port';

@Injectable()
export class StripePaymentGatewayAdapter implements PaymentGatewayPort {
  readonly isConfigured: boolean;
  private readonly stripe?: Stripe;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.isConfigured = Boolean(key);
    if (key) this.stripe = new Stripe(key);
  }

  async attempt(payment: Payment): Promise<PaymentAttemptOutcome> {
    return this.charge(payment);
  }

  async charge(payment: Payment, paymentMethod?: PaymentMethod): Promise<PaymentAttemptOutcome> {
    if (!this.stripe) return this.unavailable();
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: Math.round(Number(payment.amount) * 100),
          currency: 'usd',
          confirm: true,
          ...(paymentMethod
            ? {
                customer: paymentMethod.stripe_customer_id,
                payment_method: paymentMethod.stripe_payment_method_id,
                off_session: true,
              }
            : {}),
          // DEF-13: `organizationId` rides along so the webhook processor has an
          // independent source to cross-check the payment row's organization
          // against. `payment.organization_id` is NOT NULL, so it is always
          // written. Changing this body changes what Stripe has already accepted
          // under `payment.idempotency_key`: a retry of a payment created before
          // this landed reuses the key with a different body, which Stripe
          // rejects — such payments have to be drained before deploy (owner
          // statement, 2026-10-04: none is in flight).
          metadata: { paymentId: payment.id, organizationId: payment.organization_id },
        },
        { idempotencyKey: payment.idempotency_key },
      );
      return {
        succeeded: intent.status === 'succeeded', transactionId: intent.id,
        gatewayReference: intent.id, gatewayStatus: intent.status, gatewayResponse: JSON.stringify(intent),
        ...(intent.status === 'succeeded' ? {} : { failureReason: `Stripe payment status: ${intent.status}`, failureCode: 'PAYMENT_NOT_SUCCEEDED' }),
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  async refund(refund: Refund): Promise<PaymentAttemptOutcome> {
    if (!this.stripe) return this.unavailable();
    try {
      const result = await this.stripe.refunds.create(
        { payment_intent: refund.payment_id, amount: Math.round(Number(refund.amount) * 100), metadata: { refundId: refund.id } },
        { idempotencyKey: refund.idempotency_key },
      );
      return {
        succeeded: result.status === 'succeeded', transactionId: result.id,
        gatewayReference: result.id, gatewayStatus: result.status ?? undefined, gatewayResponse: JSON.stringify(result),
        ...(result.status === 'succeeded' ? {} : { failureReason: `Stripe refund status: ${result.status}`, failureCode: 'REFUND_NOT_SUCCEEDED' }),
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  private unavailable(): PaymentAttemptOutcome {
    return { succeeded: false, failureReason: 'No payment gateway is configured for this deployment', failureCode: 'GATEWAY_NOT_CONFIGURED' };
  }
  private failure(error: unknown): PaymentAttemptOutcome {
    const e = error as { message?: string; code?: string; type?: string };
    return { succeeded: false, failureReason: e.message ?? 'Stripe request failed', failureCode: e.code ?? e.type ?? 'GATEWAY_ERROR', gatewayStatus: 'failed', gatewayResponse: JSON.stringify({ message: e.message, code: e.code, type: e.type }) };
  }
}