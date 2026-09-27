import { Injectable } from '@nestjs/common';
import { BackgroundWorker } from '../../shared/workers/background-worker';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ReportJobService } from '../services/report-job.service';
import { WORKER_BATCH_SIZES } from '../../shared/workers/worker-config';

/**
 * Runs queued report jobs (Phase B, P6-02/P6-03).
 *
 * Shape is deliberately identical to `MembershipExpiryWorker`: `extends
 * BackgroundWorker`, a `WORKER_<NAME>` config suffix, a constructor that forwards
 * `(configService, schedulerRegistry)` to `super`, and a `runOnce()` that does nothing
 * but call one domain-service method and log its counts. The base class owns
 * registration, the enable/disable switch, the cadence, the re-entrancy guard and
 * error handling — a worker here must not grow its own scheduling.
 *
 * That re-entrancy guard matters more for this worker than for the expiry sweep: a
 * tick runs a *batch* of jobs, each of which executes a real query, so a slow batch
 * must not stack another one behind it.
 *
 * Disabled unless `WORKERS_ENABLED=true` or `WORKERS_REPORT_JOBS_ENABLED=true`, exactly
 * like every other worker — `isWorkerEnabled()` is the single decision point and this
 * class does not bypass it.
 */
@Injectable()
export class ReportJobWorker extends BackgroundWorker {
  protected readonly workerName = 'REPORT_JOBS';
  protected readonly workerInstanceKey = 'report-job-worker-interval';

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly reportJobService: ReportJobService,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const result = await this.reportJobService.runPendingBatch(
      WORKER_BATCH_SIZES.REPORT_JOBS ?? 5,
    );
    if (result.scanned > 0) {
      this.logger.log(
        `Report jobs: scanned ${result.scanned}, completed ${result.completed}, failed ${result.failed}`,
      );
    }
  }
}
