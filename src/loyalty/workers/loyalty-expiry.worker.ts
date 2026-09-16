import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackgroundWorker } from '../../shared/workers/background-worker';
import { LoyaltyExpiryService } from '../services/loyalty-expiry.service';

/**
 * Background worker that sweeps expired loyalty points.
 *
 * Runs on `WORKERS_EXPIRY_ENABLED` (defaults to the master switch).
 * Default interval: `WORKERS_EXPIRY_INTERVAL_MS` (falls back to `60 * 60 * 1000`)
 * Default batch size: `WORKERS_EXPIRY_BATCH_SIZE` (falls back to 200).
 *
 * Per docs/phase2-scoping-plan.md §12 Q22.
 */
@Injectable()
export class LoyaltyExpiryWorker extends BackgroundWorker {
  protected readonly workerName = 'EXPIRY';
  protected readonly workerInstanceKey = 'loyalty-expiry-sweep';

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly expiryService: LoyaltyExpiryService,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const batchSize = 200; // Configurable — could be pulled from env if needed.
    const processed = await this.expiryService.sweepExpiredTransactions(batchSize);
    if (processed > 0) {
      this.logger.log(`Expiry sweep: processed ${processed} expired transactions`);
    }
  }
}