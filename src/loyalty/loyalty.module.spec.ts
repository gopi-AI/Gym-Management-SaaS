import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { LoyaltyModule } from './loyalty.module';
import { LoyaltyAccrualService } from './services/loyalty-accrual.service';
import { LoyaltyExpiryService } from './services/loyalty-expiry.service';
import { LoyaltyReadService } from './services/loyalty-read.service';
import { LoyaltyExpiryWorker } from './workers/loyalty-expiry.worker';
import { MembersService } from '../members/services/members.service';
import { MembersModule } from '../members/members.module';
import { TenantContextService } from '../shared/tenant/tenant-context.service';
import { LoyaltyAccount } from './entities/loyalty-account.entity';
import { LoyaltyTransaction } from './entities/loyalty-transaction.entity';
import { LoyaltyRule } from './entities/loyalty-rule.entity';
import { LoyaltyReward } from './entities/loyalty-reward.entity';
import { Organization } from '../tenancy/entities/organization.entity';
import { OutboxService } from '../shared/outbox/outbox.service';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { WorkersModule } from '../shared/workers/workers.module';
import { EventHandlerModule } from '../shared/event-handler/event-handler.module';
import { EventHandlerRegistry } from '../shared/event-handler/event-handler.registry';

/**
 * Real-module DI verification for the Loyalty feature module.
 *
 * This spec boots the ACTUAL `LoyaltyModule` through `Test.createTestingModule`,
 * exactly as the PT and Member 360 module specs do, and asserts that
 * `LoyaltyAccrualService` (and its module peers) resolve from the real Nest DI
 * container.
 *
 * WHY THIS TEST EXISTS
 * -----------------
 * The pre-existing boot blocker this change fixes was a DI failure: `LoyaltyAccrualService`
 * injects `@InjectRepository(Organization)`, but `LoyaltyModule`'s
 * `TypeOrmModule.forFeature([...])` initially omitted `Organization`. TenancyModule exports
 * only services — never repositories — so no module in the chain could satisfy that token and the
 * whole app failed to boot. The unit/integration specs never caught it because they construct
 * `LoyaltyAccrualService` by hand with mock repositories and never touch the Nest container.
 *
 * This spec booting the real module closes exactly that gap: if any service's repository token
 * is ever missing from the module's own `forFeature` array, `compile()` throws and the suite
 * goes red immediately.
 *
 * External modules (`TenancyModule`, `WorkersModule`), the `OutboxModule` and —
 * since P6-28's read path — `MembersModule` are swapped for minimal stubs so the
 * test verifies the Loyalty module's OWN wiring in isolation. The repository tokens
 * registered by LoyaltyModule's `forFeature` are what matter here; MembersModule's
 * transitive graph (S3, memberships, attendance, PT, workouts, diet) is not this
 * spec's subject, and booting it for real would test that graph instead.
 */

@Module({})
class EmptyModule {}

@Module({
  providers: [
    { provide: OutboxService, useValue: { saveEventEnvelope: jest.fn() } },
  ],
  exports: [OutboxService],
})
class StubOutboxModule {}

/**
 * P6-28 added `MembersModule` to LoyaltyModule's imports because
 * `LoyaltyReadService` rejects a cross-tenant member through the org-scoped
 * `MembersService.findOne()`. The read service only needs that one method, so the
 * stub provides exactly it — plus `TenantContextService`, which it reads the
 * authorized organization from. `TenancyModule` is stubbed to `EmptyModule` above,
 * so without this token the read service cannot be constructed at all.
 */
@Module({
  providers: [
    { provide: MembersService, useValue: { findOne: jest.fn() } },
    { provide: TenantContextService, useValue: { getCurrentOrganizationId: jest.fn() } },
  ],
  exports: [MembersService, TenantContextService],
})
class StubMembersModule {}

describe('LoyaltyModule (real DI container)', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', retryAttempts: 0 }), LoyaltyModule, EventHandlerModule],
    })
      .overrideModule(TenancyModule)
      .useModule(EmptyModule)
      .overrideModule(WorkersModule)
      .useModule(EmptyModule)
      .overrideModule(OutboxModule)
      .useModule(StubOutboxModule)
      .overrideModule(MembersModule)
      .useModule(StubMembersModule)
      // The accrual service uses @InjectDataSource() directly. Register the token via
      // TypeOrmModule.forRoot above, then swap in an inert stub so no connection is
      // ever attempted.
      .overrideProvider(getDataSourceToken())
      .useValue({})
      // The expiry worker's BackgroundWorker needs ConfigService/SchedulerRegistry at compile
      // time; we don't exercise it here, so stub the worker itself.
      .overrideProvider(LoyaltyExpiryWorker)
      .useValue({})
      // LoyaltyModule's own forFeature entities — swap in inert stand-ins.
      .overrideProvider(getRepositoryToken(LoyaltyAccount))
      .useValue({})
      .overrideProvider(getRepositoryToken(LoyaltyTransaction))
      .useValue({})
      .overrideProvider(getRepositoryToken(LoyaltyRule))
      .useValue({})
      .overrideProvider(getRepositoryToken(LoyaltyReward))
      .useValue({})
      // ⚠️ The regression guard for the original boot blocker. If this token is dropped
      //    from LoyaltyModule.forFeature again, compile() throws here.
      .overrideProvider(getRepositoryToken(Organization))
      .useValue({})
      .compile();
  });

  it('compiles the real LoyaltyModule without DI errors', () => {
    expect(module).toBeDefined();
  });

  it('resolves LoyaltyAccrualService from the real container', () => {
    expect(module.get(LoyaltyAccrualService)).toBeDefined();
  });

  it('resolves LoyaltyExpiryService from the real container', () => {
    expect(module.get(LoyaltyExpiryService)).toBeDefined();
  });

  it('resolves LoyaltyReadService (P6-28) from the real container', () => {
    expect(module.get(LoyaltyReadService)).toBeDefined();
  });

  it('resolves the MembersService that LoyaltyReadService depends on', () => {
    expect(module.get(MembersService)).toBeDefined();
  });

  it('stubs LoyaltyExpiryWorker (needs ConfigService/SchedulerRegistry, not part of this DI validation)', () => {
    expect(module.get(LoyaltyExpiryWorker)).toEqual({});
  });

  it('registers the Organization repository token in LoyaltyModule.forFeature', () => {
    expect(module.get(getRepositoryToken(Organization))).toBeDefined();
  });

  it('registers the EventHandlerRegistry used by onModuleInit', () => {
    expect(module.get(EventHandlerRegistry)).toBeDefined();
  });
});
