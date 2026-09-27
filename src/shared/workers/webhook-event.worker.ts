import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackgroundWorker } from './background-worker';
import { WORKER_BATCH_SIZES } from './worker-config';
import { WebhookEventProcessor } from '../../finance/services/webhook-event.processor';

@Injectable()
export class WebhookEventWorker extends BackgroundWorker {
  protected readonly workerName = 'WEBHOOK';
  protected readonly workerInstanceKey = 'webhook-event-worker-interval';
  constructor(config: ConfigService, scheduler: SchedulerRegistry, private readonly processor: WebhookEventProcessor) { super(config, scheduler); }
  protected async runOnce(): Promise<void> {
    const processed = await this.processor.processBatch(WORKER_BATCH_SIZES.WEBHOOK);
    if (processed > 0) this.logger.log(`Processed ${processed} webhook event(s)`);
  }
}