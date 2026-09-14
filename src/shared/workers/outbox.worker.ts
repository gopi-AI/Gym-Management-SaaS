import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { BackgroundWorker } from './background-worker';
import { OutboxPoller } from '../outbox/outbox.poller';
import { OUTBOX_LOCK_DURATION_MS, WORKER_BATCH_SIZES } from './worker-config';

/**
 * Drains the transactional outbox (see `OutboxPoller`).
 *
 * The poller was deliberately never wired to `OnModuleInit`; this worker is the
 * scheduler that drives it, so outbox dispatch cadence is an operational
 * decision (interval + enable flag) rather than something that happens during
 * boot. Events are claimed with a lease, so several API instances can run this
 * worker at the same time without double-dispatching.
 */
@Injectable()
export class OutboxWorker extends BackgroundWorker {
  protected readonly workerName = 'OUTBOX';
  protected readonly workerInstanceKey = 'outbox-worker-interval';

  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly outboxPoller: OutboxPoller,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const processed = await this.outboxPoller.processPendingEvents(
      this.workerId,
      WORKER_BATCH_SIZES.OUTBOX,
      OUTBOX_LOCK_DURATION_MS,
    );
    if (processed > 0) {
      this.logger.log(`Dispatched ${processed} outbox event(s)`);
    }
  }
}
