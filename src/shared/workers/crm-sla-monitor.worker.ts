import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackgroundWorker } from './background-worker';
import { WORKER_BATCH_SIZES } from './worker-config';
import { SlaService } from '../../crm/services/sla.service';

/**
 * P3-07 — "SLA monitoring worker" (§9): "Detect breaches, escalate, write
 * `CRM_SLA_BREACHES`."
 *
 * Two phases per tick, both in `SlaService` and both idempotent:
 *
 *   1. `detectBreaches`   — opens a breach row for every follow-up past its SLA
 *                           deadline (and for leads past first-response), setting
 *                           the follow-up to `breached` and publishing
 *                           `SlaBreached`. A subject that already has an
 *                           unresolved breach is skipped, so re-running is safe.
 *   2. `escalateDueBreaches` — escalates breaches whose `escalation_after_hours`
 *                           window has elapsed. An already-escalated breach is
 *                           never escalated twice.
 *
 * §14.7 warns that a new worker which is not idempotent "must add its own guard";
 * those two guards are that. Both phases are batched, so a backlog drains over
 * successive ticks rather than in one unbounded pass.
 */
@Injectable()
export class CrmSlaMonitorWorker extends BackgroundWorker {
  protected readonly workerName = 'CRM_SLA_MONITOR';
  protected readonly workerInstanceKey = 'crm-sla-monitor-worker-interval';

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly slaService: SlaService,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const limit = WORKER_BATCH_SIZES.CRM_SLA_MONITOR;

    const detected = await this.slaService.detectBreaches({ limit });
    if (detected.followUpOverdue > 0 || detected.firstResponse > 0) {
      this.logger.log(
        `Recorded ${detected.followUpOverdue} overdue follow-up breach(es) and ${detected.firstResponse} first-response breach(es)`,
      );
    }

    const escalated = await this.slaService.escalateDueBreaches({ limit });
    if (escalated.escalated > 0) {
      this.logger.log(`Escalated ${escalated.escalated} SLA breach(es)`);
    }
  }
}
