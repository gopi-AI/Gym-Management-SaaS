import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { WorkersModule } from '../shared/workers/workers.module';
import { EventHandlerRegistry } from '../shared/event-handler/event-handler.registry';
import { LoyaltyAccount } from './entities/loyalty-account.entity';
import { LoyaltyTransaction } from './entities/loyalty-transaction.entity';
import { LoyaltyRule } from './entities/loyalty-rule.entity';
import { LoyaltyReward } from './entities/loyalty-reward.entity';
import { Organization } from '../tenancy/entities/organization.entity';
import { LoyaltyAccrualService } from './services/loyalty-accrual.service';
import { LoyaltyExpiryService } from './services/loyalty-expiry.service';
import { LoyaltyReadService } from './services/loyalty-read.service';
import { LoyaltyController } from './controllers/loyalty.controller';
import { LoyaltyDashboardController } from './controllers/loyalty-dashboard.controller';
import { MembersModule } from '../members/members.module';
import { LoyaltyExpiryWorker } from './workers/loyalty-expiry.worker';
import {
  ATTENDANCE_EVENT_TYPE,
  LOYALTY_EVENT_VERSION,
} from './loyalty.constants';

/**
 * Loyalty (Phase 2): points-accrual engine with configurable earning rules,
 * per-member-per-organization accounts, and an append-only transaction ledger.
 *
 * Phase 2 scope:
 *   - `LOYALTY_ACCOUNTS`     — per-member per-org points balance
 *   - `LOYALTY_TRANSACTIONS`  — append-only ledger (earn, expire, adjust, redeem)
 *   - `LOYALTY_RULES`         — configurable earning rules (check_in, workout_logged)
 *   - `LOYALTY_REWARDS`       — schema-only seat-filler (unused in Phase 2)
 *
 * WIRING (resolved):
 *   - `LoyaltyAccrualService.handleCheckIn()` IS NOW wired via the in-process
 *     `EventHandlerRegistry` at module init. The handler is registered against
 *     `AttendanceEventRecorded.v1` and the poller dispatches to it.
 *   - `LoyaltyAccrualService.handleWorkoutLogged()` still has no producer (Workouts
 *     module does not yet emit `WorkoutSessionLogged.v1`) — registration is deferred
 *     until the producer exists.
 *
 * What IS live:
 *   - `LoyaltyExpiryWorker` (background worker) — sweeps expired points daily.
 *     Enabled via `WORKERS_EXPIRY_ENABLED=true` or `WORKERS_ENABLED=true`.
 *
 * The eventual target per docs/event-contracts.md is RabbitMQ-based delivery.
 * This in-process registry is a transitional stand-in — revisit when there are
 * multiple live consumers or a real cross-process need.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LoyaltyAccount,
      LoyaltyTransaction,
      LoyaltyRule,
      LoyaltyReward,
      Organization,
    ]),
    OutboxModule,
    TenancyModule,
    WorkersModule,
    // P6-28: the read service resolves the member through `MembersService.findOne()`
    // so a cross-tenant member id is rejected rather than answered with zeros.
    // Cycle-free: only AppModule imports LoyaltyModule.
    MembersModule,
  ],
  controllers: [LoyaltyController, LoyaltyDashboardController],
  providers: [
    LoyaltyAccrualService,
    LoyaltyExpiryService,
    LoyaltyReadService,
    LoyaltyExpiryWorker,
  ],
  exports: [
    LoyaltyAccrualService,
    LoyaltyExpiryService,
    LoyaltyReadService,
    TypeOrmModule,
  ],
})
export class LoyaltyModule implements OnModuleInit {
  private readonly logger = new Logger(LoyaltyModule.name);

  constructor(
    private readonly accrualService: LoyaltyAccrualService,
    private readonly handlerRegistry: EventHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.handlerRegistry.register(
      ATTENDANCE_EVENT_TYPE,
      LOYALTY_EVENT_VERSION,
      async (envelope) => {
        const payload = envelope.payload as Record<string, unknown>;
        await this.accrualService.handleCheckIn({
          organizationId: envelope.organizationId,
          memberId: payload.memberId as string,
          eventType: payload.eventType as string,
          eventId: payload.eventId as string,
          attendanceRecordId: envelope.correlationId,
          eventTime: payload.eventTime as string,
        });
      },
    );

    this.logger.log(
      `Registered handler for ${ATTENDANCE_EVENT_TYPE}.${LOYALTY_EVENT_VERSION} (LoyaltyAccrualService.handleCheckIn)`,
    );
  }
}