import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { BackgroundWorker } from "./background-worker";
import { WORKER_BATCH_SIZES } from "./worker-config";
import { FollowUpsService } from "../../crm/services/follow-ups.service";

/**
 * P3-07 — "Follow-up scheduler worker (enhanced)" (§9).
 *
 * §9 gives this worker one responsibility: "Generate follow-ups per policy;
 * surface due/overdue ones." Generation is the write; surfacing is the read side
 * and lives on `GET /v1/follow-ups/due`, so there is nothing for a timer to do
 * there.
 *
 * The domain rule lives in `FollowUpsService.generateFollowUps`, which is
 * worker-only by design: the scan spans organizations (a worker has no tenant
 * context), and every follow-up it writes is idempotent — a lead with an open
 * follow-up is skipped, and the policy cap is honoured — so a repeated tick, or a
 * second application instance ticking concurrently, cannot duplicate follow-ups.
 */
@Injectable()
export class CrmFollowUpsWorker extends BackgroundWorker {
  protected readonly workerName = "CRM_FOLLOW_UPS";
  protected readonly workerInstanceKey = "crm-follow-ups-worker-interval";

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly followUpsService: FollowUpsService,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const result = await this.followUpsService.generateFollowUps({
      limit: WORKER_BATCH_SIZES.CRM_FOLLOW_UPS,
    });
    if (result.generated > 0) {
      this.logger.log(
        `Generated ${result.generated} follow-up(s) from ${result.policies} active policy(ies) out of ${result.scanned} candidate lead(s)`,
      );
    }
  }
}
