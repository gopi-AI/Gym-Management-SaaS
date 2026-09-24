import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackgroundWorker } from '../../shared/workers/background-worker';
import { MaterializedViewRefreshService } from '../services/materialized-view-refresh.service';

/**
 * Refreshes the reporting materialized views (P6-15; §7.3's "Cron worker").
 *
 * Shape is deliberately identical to `ReportJobWorker` and
 * `MembershipExpiryWorker`: `extends BackgroundWorker`, a `WORKER_<NAME>` config
 * suffix, a constructor that forwards `(configService, schedulerRegistry)` to
 * `super`, and a `runOnce()` that does nothing but call one domain-service method
 * and log its counts. The base class owns registration, the enable/disable
 * switch, the cadence, the re-entrancy guard and error handling — a worker here
 * must not grow its own scheduling.
 *
 * **This tick interval is not the per-view cadence.** §7.3 gives each view its own
 * frequency (hourly, 6-hourly, daily) and the plan is explicit that those settings
 * live in code/config rather than in `REPORTS_MATERIALIZED_VIEWS` rows (P6-29
 * resolution (B)). `MaterializedViewRefreshService.refreshDue()` applies that
 * per-view cadence by comparing `last_refreshed` against it; this interval only
 * decides how often the sweep *looks*. A short interval therefore makes a due
 * view refresh promptly, and cannot make a view refresh more often than §7.3
 * allows — the due-check is the gate, not the timer.
 *
 * `runOnce` is a no-op when nothing is due (the common case at a 5-minute
 * interval), so the log line is written only when the sweep actually did
 * something or something failed — the same quiet-when-idle convention
 * `ReportJobWorker` uses.
 *
 * Disabled unless `WORKERS_ENABLED=true` or
 * `WORKERS_MATERIALIZED_VIEW_REFRESH_ENABLED=true`, exactly like every other
 * worker — `isWorkerEnabled()` is the single decision point and this class does
 * not bypass it.
 */
@Injectable()
export class MaterializedViewRefreshWorker extends BackgroundWorker {
  protected readonly workerName = 'MATERIALIZED_VIEW_REFRESH';
  protected readonly workerInstanceKey = 'materialized-view-refresh-worker-interval';

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly refreshService: MaterializedViewRefreshService,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const result = await this.refreshService.refreshDue();
    if (result.refreshed > 0 || result.failed > 0) {
      this.logger.log(
        `Materialized views: scanned ${result.scanned}, refreshed ${result.refreshed}, ` +
          `skipped ${result.skipped}, failed ${result.failed}`,
      );
    }
  }
}