import { Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from './payment-gateway.port';
import { PAYMENT_RETRY_DEFAULTS } from '../finance.constants';

/** Result of one retry run (logged by the worker, asserted by the specs). */
export interface PaymentRetryRunResult {
  /** Pending payments examined. */
  attempted: number;
  /** Attempts that settled the payment. */
  succeeded: number;
  /** Attempts that moved a payment to its terminal `failed` state. */
  failed: number;
  /** Attempts that left the payment `pending` with a backoff scheduled. */
  rescheduled: number;
  /** Set when the run did nothing; e.g. no gateway is configured. */
  skippedReason?: string;
}

/**
 * Payment retry use case.
 *
 * Deployed as a scheduled background worker (see
 * `src/shared/workers/payment-retry.worker.ts`). The provider interaction goes
 * through `PaymentGatewayPort`, so this class stays provider-agnostic and every
 * retry rule below is unit-testable with a stub gateway:
 *
 *   - only `pending` payments are retried;
 *   - each attempt increments `retry_count` and stamps `last_attempt_at`;
 *   - failures are rescheduled with exponential backoff
 *     (`paymentRetryDelayMs`) until `maxAttempts`, then become terminal
 *     `failed` and publish `PaymentFailed.v1`;
 *   - successes publish `PaymentSucceeded.v1` and settle the invoice.
 *
 * WORKER-ONLY: there is no request/tenant context here (no authenticated user),
 * so the run spans all organizations and every write is scoped by the payment
 * row's own `organization_id` inside `PaymentsService`.
 */
@Injectable()
export class PaymentRetryService {
  private readonly logger = new Logger(PaymentRetryService.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async retryDuePayments(
    options: { limit?: number; maxAttempts?: number; now?: Date } = {},
  ): Promise<PaymentRetryRunResult> {
    const now = options.now ?? new Date();
    const limit = options.limit ?? PAYMENT_RETRY_DEFAULTS.BATCH_SIZE;
    const maxAttempts = options.maxAttempts ?? PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS;

    // Phase 1 has no payment provider (money is taken at the desk and recorded
    // as an already-succeeded payment), so there is nothing to charge. Reporting
    // a skipped run keeps pending rows intact for when a provider is configured
    // instead of failing them against a gateway that does not exist.
    if (!this.gateway.isConfigured) {
      this.logger.debug('Payment retry run skipped: no payment gateway configured');
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        rescheduled: 0,
        skippedReason: 'gateway_not_configured',
      };
    }

    const due = await this.paymentsService.findDueRetries(now, limit);
    const result: PaymentRetryRunResult = {
      attempted: due.length,
      succeeded: 0,
      failed: 0,
      rescheduled: 0,
    };

    for (const payment of due) {
      try {
        const applied = await this.paymentsService.attemptWithSavedMethod(payment, now, maxAttempts);

        if (applied.status === 'succeeded') result.succeeded += 1;
        else if (applied.exhausted) result.failed += 1;
        else result.rescheduled += 1;
      } catch (error) {
        // One bad payment must not abort the whole run: the remaining retries
        // stay scheduled and the failure is surfaced in the logs.
        this.logger.error(
          `Payment retry failed for payment ${payment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return result;
  }
}
