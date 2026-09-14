import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackgroundWorker } from './background-worker';
import { PaymentRetryService } from '../../finance/services/payment-retry.service';
import { PAYMENT_RETRY_DEFAULTS } from '../../finance/finance.constants';
import { WORKER_BATCH_SIZES } from './worker-config';

/**
 * Retries payments that are still `pending` (docs/task-backlog.md
 * "PaymentRetryWorker").
 *
 * The retry policy and the state bookkeeping live in `PaymentsService` /
 * `PaymentRetryService`; this class only supplies cadence. In Phase 1 no
 * provider is bound to `PAYMENT_GATEWAY`, so a run reports
 * `skippedReason: 'gateway_not_configured'` and touches nothing — pending
 * payments stay pending for the day a real provider is configured, instead of
 * being failed against a gateway that does not exist.
 */
@Injectable()
export class PaymentRetryWorker extends BackgroundWorker {
  protected readonly workerName = 'PAYMENT_RETRY';
  protected readonly workerInstanceKey = 'payment-retry-worker-interval';

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly paymentRetryService: PaymentRetryService,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const result = await this.paymentRetryService.retryDuePayments({
      limit: WORKER_BATCH_SIZES.PAYMENT_RETRY,
      maxAttempts: PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS,
    });

    if (result.skippedReason) {
      this.logger.debug(`Payment retry run skipped: ${result.skippedReason}`);
      return;
    }
    if (result.attempted > 0) {
      this.logger.log(
        `Payment retry run: ${result.attempted} attempted, ${result.succeeded} succeeded, ` +
          `${result.rescheduled} rescheduled, ${result.failed} failed`,
      );
    }
  }
}
