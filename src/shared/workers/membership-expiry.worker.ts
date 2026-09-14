import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackgroundWorker } from './background-worker';
import { MembershipsService } from '../../memberships/services/memberships.service';
import { WORKER_BATCH_SIZES } from './worker-config';

/**
 * Expires memberships whose end date has passed (docs/task-backlog.md
 * "MembershipExpiryChecker").
 *
 * The domain rule lives in `MembershipsService.expireDueMemberships`, which is
 * worker-only by design: this scan spans organizations (a worker has no tenant
 * context), re-validates every candidate under a row lock in its own
 * transaction, and publishes `MembershipExpired.v1` exactly once per membership.
 *
 * One batch per tick: the default cadence (hourly) plus a 200-row batch keeps up
 * with normal volumes, and the row lock makes a backlog safe to drain over
 * successive ticks.
 */
@Injectable()
export class MembershipExpiryWorker extends BackgroundWorker {
  protected readonly workerName = 'MEMBERSHIP_EXPIRY';
  protected readonly workerInstanceKey = 'membership-expiry-worker-interval';

  constructor(
    configService: ConfigService,
    schedulerRegistry: SchedulerRegistry,
    private readonly membershipsService: MembershipsService,
  ) {
    super(configService, schedulerRegistry);
  }

  protected async runOnce(): Promise<void> {
    const result = await this.membershipsService.expireDueMemberships({
      limit: WORKER_BATCH_SIZES.MEMBERSHIP_EXPIRY,
    });
    if (result.expired > 0) {
      this.logger.log(
        `Expired ${result.expired} membership(s) out of ${result.scanned} due candidate(s)`,
      );
    }
  }
}
