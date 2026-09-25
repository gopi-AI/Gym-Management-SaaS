import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { MembershipsModule } from '../../memberships/memberships.module';
import { FinanceModule } from '../../finance/finance.module';
import { CrmModule } from '../../crm/crm.module';
import { OutboxWorker } from './outbox.worker';
import { MembershipExpiryWorker } from './membership-expiry.worker';
import { PaymentRetryWorker } from './payment-retry.worker';
import { WebhookEventWorker } from './webhook-event.worker';
import { CrmFollowUpsWorker } from './crm-follow-ups.worker';
import { CrmSlaMonitorWorker } from './crm-sla-monitor.worker';
import { DunningWorker } from './dunning.worker';

/**
 * Background workers.
 *
 * Each worker is disabled unless `WORKERS_ENABLED=true` (or its own
 * `WORKERS_<NAME>_ENABLED`) — see `worker-config.ts`. The module only wires the
 * workers to the domain services that own the rules; no worker contains business
 * logic of its own.
 *
 * `ScheduleModule.forRoot()` must be registered in the application module (it is,
 * in `AppModule`) because the dynamic interval registration here goes through
 * `SchedulerRegistry`.
 */
@Module({
  imports: [OutboxModule, MembershipsModule, FinanceModule, CrmModule],
  providers: [
    OutboxWorker,
    MembershipExpiryWorker,
    PaymentRetryWorker,
    WebhookEventWorker,
    CrmFollowUpsWorker,
    CrmSlaMonitorWorker,
    DunningWorker,
  ],
  exports: [
    OutboxWorker,
    MembershipExpiryWorker,
    PaymentRetryWorker,
    WebhookEventWorker,
    CrmFollowUpsWorker,
    CrmSlaMonitorWorker,
    DunningWorker,
  ],
})
export class WorkersModule {}

