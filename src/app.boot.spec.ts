import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

/**
 * AppModule boot regression — DI-graph + provider-instantiation guard.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The working tree could not boot while the entire gate suite stayed green:
 * 103 suites, 1069 tests, `typecheck`, `lint` and a from-scratch migration
 * replay all passed. Two independent blockers were invisible because nothing in
 * the suite ever compiled `AppModule` through the real Nest container:
 *
 *  - BLOCKER-1 — missing module export. `WorkersModule` provides
 *    `WebhookEventWorker`, whose constructor injects `WebhookEventProcessor`.
 *    That class is provided by `FinanceModule`; because it was absent from
 *    `FinanceModule`'s `exports` array, Nest could not resolve the worker in the
 *    `WorkersModule` context and `compile()` threw:
 *      "Nest can't resolve dependencies of the WebhookEventWorker
 *       (ConfigService, SchedulerRegistry, ?). Please make sure that the
 *       argument WebhookEventProcessor at index [2] is available in the
 *       WorkersModule context."
 *
 *  - BLOCKER-2 — unguarded SDK construction. `GatewayWebhookService` ran
 *    `new Stripe(config.get<string>('STRIPE_SECRET_KEY', ''))` during DI. With
 *    the key absent — its normal state, since Stripe is an OPTIONAL credential —
 *    the Stripe SDK throws `Neither apiKey nor config.authenticator provided`
 *    mid-instantiation and takes the whole app down.
 *
 * Both are runtime DI/constructor failures, so neither `tsc` nor `jest` could
 * see them. `compile()` is the only thing that exercises them, which is exactly
 * what this spec does. It is the regression guard for both.
 *
 * HERMETICITY REQUIREMENT (why every external dependency is stubbed)
 * ------------------------------------------------------------------
 * This is a UNIT-level boot check, not an integration test: it must pass on a
 * machine with no Postgres and no Redis. Two Nest providers would otherwise open
 * real sockets during `compile()`:
 *
 *  - `TypeOrmModule.forRootAsync`'s DataSource factory does
 *    `await dataSource.initialize()` (see @nestjs/typeorm's
 *    `createDataSourceFactory`), i.e. a live Postgres connection, and
 *    `TypeOrmModule.forFeature`'s repository providers then call
 *    `dataSource.getRepository(...)` on it.
 *  - `CACHE_MANAGER`'s factory awaits `redisStore(...)`, which awaits
 *    `redisClient.connect()`; cache-manager-redis-yet rethrows on failure.
 *
 * The `DataSource` token is therefore replaced with an inert stand-in that still
 * satisfies the `forFeature` repository factories, and `CACHE_MANAGER` with an
 * empty object. The spec ASSERTS that the stand-in is the injected instance, so
 * it cannot silently pass by reaching a real database.
 *
 * A note on the STRIPE condition: `ConfigModule.forRoot()` snapshots the
 * environment when `./app.module` is first evaluated, so the variables below are
 * cleared BEFORE that module is required (see the `require` further down). That
 * is also why this lives in its own file rather than in `app.module.spec.ts`,
 * whose first line already imports `./app.module` — there, the environment would
 * be snapshotted before any test code could run.
 */

/** Env captured so the mutations below cannot leak into other spec files. */
const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

// `delete`, not `= undefined`: assigning undefined to process.env stores the
// literal string "undefined", which is truthy and would re-arm BLOCKER-2.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
// Pinned so the boot check behaves identically on a dev laptop and in CI, and so
// `validateEnv`'s production-only guards (which are covered separately by
// `app.module.spec.ts`) cannot make this spec fail for an unrelated reason.
process.env.NODE_ENV = 'test';

// IMPORTANT — module evaluation order.
//
// `AppModule` must be the FIRST application module evaluated, exactly as it is
// in `src/main.ts`. The module graph contains a cycle
// (MembersModule <-> MembershipsModule -> FinanceModule -> forwardRef(MembersModule));
// pulling one of those modules in ahead of `app.module` leaves a `forwardRef`
// host still `undefined` when the scanner walks it, and `compile()` then fails
// with a misleading
//
//   "The module at index [3] of the MembershipsModule \"imports\" array is undefined"
//
// This is a pre-existing property of the graph, unrelated to the two boot
// blockers — verified by requiring each module individually before `app.module`
// and observing the same failure. Hence `app.module` is required first below and
// the remaining symbols are destructured from that same require, rather than
// imported at the top of the file.
const { AppModule } = require('./app.module') as typeof import('./app.module');

// Safe to require once `app.module` has been evaluated: this module is already
// in the cache, so these are property lookups into the graph that was built
// above, not new evaluation entry points.
const { WebhookEventProcessor } =
  require('./finance/services/webhook-event.processor') as typeof import('./finance/services/webhook-event.processor');
const { GatewayWebhookService } =
  require('./finance/services/gateway-webhook.service') as typeof import('./finance/services/gateway-webhook.service');
const { WebhookEventWorker } =
  require('./shared/workers/webhook-event.worker') as typeof import('./shared/workers/webhook-event.worker');
const { FinanceModule } = require('./finance/finance.module') as typeof import('./finance/finance.module');

/**
 * Inert stand-in for the real `DataSource`.
 *
 * `TypeOrmModule.forFeature()` builds each `@InjectRepository(Entity)` factory as
 * `(dataSource) => dataSource.getRepository(entity)` (after consulting
 * `dataSource.entityMetadatas` / `dataSource.options`), and the module also
 * exposes `dataSource.manager` under the EntityManager token. This object
 * satisfies those three call sites without ever opening a socket, and records
 * whether anything tried to `initialize()` a real connection.
 */
const dataSourceStub = {
  entityMetadatas: [] as unknown[],
  options: { type: 'postgres' },
  manager: {},
  getRepository: (entity: unknown) => ({ __stubRepositoryFor: entity }),
  getTreeRepository: (entity: unknown) => ({ __stubTreeRepositoryFor: entity }),
  isInitialized: undefined as boolean | undefined,
  initialize: () => {
    throw new Error(
      'AppModule boot spec attempted a real database connection: ' +
        'the DataSource stub was not applied.',
    );
  },
};

/** Inert stand-in for the Redis-backed cache client (never connected). */
const cacheManagerStub = {};

describe('AppModule boot (real DI container, no live services)', () => {
  let module: TestingModule | undefined;
  let compileError: unknown;

  beforeAll(async () => {
    try {
      module = await Test.createTestingModule({ imports: [AppModule] })
        // Hermeticity: swap the real Postgres DataSource for an inert object so
        // `compile()` never calls `dataSource.initialize()`.
        .overrideProvider(getDataSourceToken())
        .useValue(dataSourceStub)
        // Hermeticity: swap the Redis-backed cache for an inert object so the
        // store factory never calls `redisClient.connect()`.
        .overrideProvider(CACHE_MANAGER)
        .useValue(cacheManagerStub)
        .compile();
    } catch (error) {
      compileError = error;
    }
  });

  it('compiles the real AppModule with STRIPE_SECRET_KEY unset (BLOCKER-1 + BLOCKER-2)', () => {
    // Compilation is the whole point: a missing `exports` entry, a provider that
    // is not available in the consuming module's context, or an SDK constructor
    // that rejects the (absent) optional key all throw here. Printing the message
    // keeps the failure diagnostic instead of an opaque beforeAll crash.
    expect(compileError instanceof Error ? compileError.message : compileError).toBeUndefined();
    expect(module).toBeDefined();
  });

  it('runs with STRIPE_SECRET_KEY genuinely absent (the BLOCKER-2 precondition)', () => {
    const config = module?.get(ConfigService);
    expect(config?.get('STRIPE_SECRET_KEY')).toBeUndefined();
    expect(config?.get('STRIPE_WEBHOOK_SECRET')).toBeUndefined();
  });

  it('resolves the WebhookEventProcessor token across the Finance -> Workers boundary (BLOCKER-1)', () => {
    // FinanceModule must EXPORT this: WebhookEventWorker lives in WorkersModule
    // and injects it, so without the export Nest cannot resolve the worker.
    expect(module?.get(WebhookEventProcessor)).toBeDefined();
    expect(module?.get(WebhookEventWorker)).toBeDefined();
  });

  it('instantiates the Stripe webhook service without a secret key (BLOCKER-2)', () => {
    // Previously `new Stripe('')` ran in the constructor and threw
    // "Neither apiKey nor config.authenticator provided" during DI.
    const webhookService = module?.get(GatewayWebhookService);
    expect(webhookService).toBeDefined();

    // The gateway port reports "not configured" rather than holding a client
    // built from an empty key.
    const finance = module?.select(FinanceModule);
    expect(finance?.get('PAYMENT_GATEWAY')).toBeDefined();
  });

  it('never attempts a real database connection or Redis connection', () => {
    // Guards the guard: if the overrides silently failed to apply, the real
    // factory would have run and `compile()` would have needed live services.
    expect(module?.get(getDataSourceToken())).toBe(dataSourceStub);
    expect(module?.get(CACHE_MANAGER)).toBe(cacheManagerStub);
    expect(dataSourceStub.isInitialized).toBeUndefined();
  });

  afterAll(() => {
    // Restore the ambient environment so this spec cannot leak into others; no
    // real connection was opened, so there is nothing to close.
    if (ORIGINAL_STRIPE_SECRET_KEY === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_SECRET_KEY;
    }
    if (ORIGINAL_STRIPE_WEBHOOK_SECRET === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_STRIPE_WEBHOOK_SECRET;
    }
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });
});
