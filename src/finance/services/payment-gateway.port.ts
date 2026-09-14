import { Injectable } from '@nestjs/common';
import { Payment } from '../entities/payment.entity';

/**
 * Outcome of a single gateway charge attempt.
 *
 * Deliberately tiny: it is the only thing the retry worker needs from a payment
 * provider, so Phase 3 can plug Stripe/Paymob/… in without touching the worker,
 * the retry bookkeeping or the `PaymentSucceeded`/`PaymentFailed` contracts.
 */
export interface PaymentAttemptOutcome {
  succeeded: boolean;
  /** Provider reference, stored on the payment when the attempt succeeds. */
  transactionId?: string;
  /** Human-readable failure reason (PaymentFailed.failureReason). */
  failureReason?: string;
  /** Machine-readable failure code (PaymentFailed.failureCode). */
  failureCode?: string;
}

/**
 * Payment provider seam.
 *
 * Phase 1 has no payment provider: money changes hands at the desk and is
 * recorded through `POST /v1/invoices/{id}/payments`, which writes an
 * already-`succeeded` payment. The retry worker therefore has nothing to retry
 * until a provider is bound to `PAYMENT_GATEWAY`.
 */
export interface PaymentGatewayPort {
  /**
   * False when no provider is configured. The retry worker then reports a
   * skipped run instead of burning pending payments to `failed` against a
   * gateway that does not exist.
   */
  readonly isConfigured: boolean;
  attempt(payment: Payment): Promise<PaymentAttemptOutcome>;
}

/** DI token for the active `PaymentGatewayPort` implementation. */
export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';

/**
 * Default (Phase 1) provider: none configured.
 *
 * `attempt` still returns a well-formed failure outcome so the surrounding code
 * path is exercised and typed, while `isConfigured = false` keeps the worker
 * from mutating any payment until a real provider replaces this binding.
 */
@Injectable()
export class UnavailablePaymentGateway implements PaymentGatewayPort {
  readonly isConfigured = false;

  async attempt(): Promise<PaymentAttemptOutcome> {
    return {
      succeeded: false,
      failureReason: 'No payment gateway is configured for this deployment',
      failureCode: 'GATEWAY_NOT_CONFIGURED',
    };
  }
}
