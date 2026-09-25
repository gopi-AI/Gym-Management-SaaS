import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DunningService } from '../../finance/services/dunning.service';
import { WORKER_BATCH_SIZES } from './worker-config';
import { BackgroundWorker } from './background-worker';

/** Daily, opt-in dunning event scan; dispatch is downstream via Outbox. */
@Injectable()
export class DunningWorker extends BackgroundWorker {
  protected readonly workerName = 'DUNNING';
  protected readonly workerInstanceKey = 'finance-dunning-worker-interval';

  constructor(config: ConfigService, scheduler: SchedulerRegistry, private readonly dunning: DunningService) {
    super(config, scheduler);
  }

  protected async runOnce(): Promise<void> {
    const result = await this.dunning.processOverdueInvoices({ limit: WORKER_BATCH_SIZES.DUNNING });
    if (result.overdueEvents || result.escalated) {
      this.logger.log(`Dunning scan: ${result.overdueEvents} overdue event(s), ${result.escalated} escalation(s)`);
    }
  }
}