import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { WorkersModule } from '../shared/workers/workers.module';
import { LoyaltyAccount } from './entities/loyalty-account.entity';
import { LoyaltyTransaction } from './entities/loyalty-transaction.entity';
import { LoyaltyRule } from './entities/loyalty-rule.entity';
import { LoyaltyReward } from './entities/loyalty-reward.entity';
import { LoyaltyAccrualService } from './services/loyalty-accrual.service';
import { LoyaltyExpiryService } from './services/loyalty-expiry.service';
import { LoyaltyExpiryWorker } from './workers/loyalty-expiry.worker';

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
 * WIRING GAP (foundational, project-wide):
 *   - `LoyaltyAccrualService.handleCheckIn()` is NOT wired to fire automatically.
 *     The outbox-to-consumer routing layer does not exist anywhere in this codebase.
 *     See `docs/phase2-scoping-plan.md` §12 Q21 — this is a known limitation.
 *   - `LoyaltyAccrualService.handleWorkoutLogged()` has no producer (Workouts module
 *     does not yet emit `WorkoutSessionLogged.v1`).
 *
 * What IS live:
 *   - `LoyaltyExpiryWorker` (background worker) — sweeps expired points daily.
 *     Enabled via `WORKERS_EXPIRY_ENABLED=true` or `WORKERS_ENABLED=true`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LoyaltyAccount,
      LoyaltyTransaction,
      LoyaltyRule,
      LoyaltyReward,
    ]),
    OutboxModule,
    TenancyModule,
    WorkersModule,
  ],
  providers: [
    LoyaltyAccrualService,
    LoyaltyExpiryService,
    LoyaltyExpiryWorker,
  ],
  exports: [
    LoyaltyAccrualService,
    LoyaltyExpiryService,
    TypeOrmModule,
  ],
})
export class LoyaltyModule {}