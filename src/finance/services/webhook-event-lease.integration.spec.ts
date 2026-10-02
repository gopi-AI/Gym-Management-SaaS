/**
 * DEF-05: the webhook-event lease and retry ceiling, against real Postgres.
 *
 * WHY THIS EXISTS ALONGSIDE THE MOCKED SPEC NEXT TO IT
 * `webhook-event.processor.spec.ts` drives `processOne` through a mocked manager,
 * so the claim in `processBatch` — raw SQL, `FOR UPDATE SKIP LOCKED`, the lease
 * predicate and the attempt ceiling — is invisible to it. A mock hands the
 * processor whatever the test wants; it cannot show that a crashed claimant's row
 * is recovered, nor that a row is left alone while its lease is live. This spec
 * drives the real `WebhookEventProcessor` against a migrated schema and reads the
 * outcome back with a SECOND SELECT, so what is asserted is the table's state
 * rather than a return value.
 *
 * NO DATABASE OBJECT IS MOCKED. This file contains no mocking helper of any kind
 * — not for the `DataSource`, not for an `EntityManager`, not for a repository.
 * The lease, the claim and the counter are
 * precisely the things a mock would replace with the answer the test is trying to
 * prove. `payments` and `refunds` are plain objects with switchable functions,
 * not mocks: they sit downstream of the behaviour under test.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/finance/services/webhook-event-lease.integration
 * The database is selected exactly as `src/data-source.ts` selects it and MUST
 * already be migrated, with the same variables exported:
 *   DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> npm run migration:run
 * Jest does not load `.env` (jest.config.js declares no setupFiles), so pass all
 * five explicitly. Without `RUN_DB_INTEGRATION=1` the block reports as SKIPPED, so
 * the hermetic `npm test` never needs a database — and because CI does not set
 * that variable, CI does not run this spec at all until the D16 hardening track
 * provisions a migrated scratch database.
 *
 * Point it at a THROWAWAY database. Every row it writes is deleted in `afterAll`.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { WebhookEventProcessor } from './webhook-event.processor';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { PaymentsService } from './payments.service';
import { InvoicesService } from './invoices.service';
import { InvoiceNumberService } from './invoice-number.service';
import { TaxRatesService } from './tax-rates.service';
import { Payment } from '../entities/payment.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { TaxLine } from '../entities/tax-line.entity';
import { CreditNote } from '../entities/credit-note.entity';
import { InvoiceNumberCounter } from '../entities/invoice-number-counter.entity';
import { TaxRate } from '../entities/tax-rate.entity';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Member } from '../../members/entities/member.entity';
import type { RefundsService } from './refunds.service';
import type { PaymentMethodsService } from './payment-methods.service';
import type { TenantContextService } from '../../shared/tenant/tenant-context.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

/**
 * Offsets that BRACKET the 60 s lease in `WEBHOOK_LOCK_DURATION_MS`.
 *
 * Deliberately literals rather than values derived from that constant: a test
 * that computed its offsets from the lease would move with it and could never
 * catch a change to it. Raised past `STALE_MS`, the lease stops considering a
 * backdated row stale and the recovery test fails; lowered past `LIVE_MS`, the
 * still-leased test fails.
 */
const STALE_MS = 120_000; // 2× the lease — must be reclaimable
const LIVE_MS = 20_000; // ⅓ of the lease — must NOT be reclaimable

interface Seeded {
  id: string;
  paymentId: string | null;
}

describeIntegration('WebhookEventProcessor lease and retry ceiling (real Postgres)', () => {
  let dataSource: DataSource;
  let applyCalls: string[];
  let failNext: boolean;
  let payments: Pick<PaymentsService, 'applyGatewayOutcome'>;
  let refunds: Pick<RefundsService, 'applyGatewayOutcome'>;
  const seededIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      // Same glob as `src/data-source.ts`, so this spec can never drift from the
      // entities the application actually maps.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    if (seededIds.length) {
      await dataSource.getRepository(WebhookEvent).delete(seededIds);
    }
    await dataSource.destroy();
  });

  beforeEach(() => {
    applyCalls = [];
    failNext = false;
    payments = {
      applyGatewayOutcome: async (_manager: unknown, paymentId: string) => {
        if (failNext) throw new Error('gateway outcome failed');
        applyCalls.push(paymentId);
      },
    } as unknown as Pick<PaymentsService, 'applyGatewayOutcome'>;
    refunds = {
      applyGatewayOutcome: async () => undefined,
    } as unknown as Pick<RefundsService, 'applyGatewayOutcome'>;
  });

  function makeProcessor(): WebhookEventProcessor {
    return new WebhookEventProcessor(
      dataSource,
      payments as unknown as PaymentsService,
      refunds as unknown as RefundsService,
    );
  }

  /**
   * Seed one webhook row. `lockedAgoMs` backdates `locked_at` directly — an
   * absolute timestamp against the database's own `now()`, never a sleep, so the
   * suite costs no wall-clock time and cannot flake on a slow machine.
   */
  async function seed(
    options: {
      status?: WebhookEvent['status'];
      attempts?: number;
      lockedAgoMs?: number;
      paymentId?: string | null;
    } = {},
  ): Promise<Seeded> {
    const id = randomUUID();
    const paymentId = options.paymentId === undefined ? `pay_${id}` : options.paymentId;
    const metadata = paymentId === null ? {} : { paymentId };
    const repository = dataSource.getRepository(WebhookEvent);

    await repository.save({
      id,
      provider: 'stripe',
      provider_event_id: `evt_${id}`,
      event_type: 'payment_intent.succeeded',
      payload: {
        id: `evt_${id}`,
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', status: 'succeeded', metadata } },
      },
      status: options.status ?? 'received',
      attempts: options.attempts ?? 0,
    });

    if (options.lockedAgoMs !== undefined) {
      await repository.update(id, { locked_at: new Date(Date.now() - options.lockedAgoMs) });
    }

    seededIds.push(id);
    return { id, paymentId };
  }

  /** Read the row back — the assertion target, not a return value. */
  async function read(id: string): Promise<WebhookEvent> {
    return dataSource.getRepository(WebhookEvent).findOneOrFail({ where: { id } });
  }

  it('recovers a row whose claimant died: an expired lease is reclaimed and the event is processed', async () => {
    const { id } = await seed({ status: 'processing', attempts: 0, lockedAgoMs: STALE_MS });

    await makeProcessor().processBatch(50);

    const row = await read(id);
    expect({
      status: row.status,
      lockedAt: row.locked_at,
      processed: row.processed_at !== null,
    }).toEqual({ status: 'processed', lockedAt: null, processed: true });
  });

  it('leaves a row alone while its lease is live', async () => {
    const { id } = await seed({ status: 'processing', attempts: 0, lockedAgoMs: LIVE_MS });

    await makeProcessor().processBatch(50);

    const row = await read(id);
    expect({
      status: row.status,
      attempts: row.attempts,
      processed: row.processed_at,
    }).toEqual({ status: 'processing', attempts: 0, processed: null });
  });

  it('increments attempts, releases the lease and leaves the row retryable', async () => {
    const { id } = await seed({ status: 'failed', attempts: 1 });
    failNext = true;

    await makeProcessor().processBatch(50);

    const row = await read(id);
    expect({
      status: row.status,
      attempts: row.attempts,
      lockedAt: row.locked_at,
      error: row.error_message,
    }).toEqual({
      status: 'failed',
      attempts: 2,
      lockedAt: null,
      error: 'gateway outcome failed',
    });
  });

  it('parks the row as dead_lettered once the attempt ceiling is reached', async () => {
    const { id } = await seed({
      status: 'failed',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS - 1,
    });
    failNext = true;

    // The claim takes it to the ceiling and the attempt fails; the row is left
    // retryable-but-exhausted, NOT parked — parking is the next poll's sweep.
    await makeProcessor().processBatch(50);
    const failed = await read(id);
    expect({ status: failed.status, attempts: failed.attempts }).toEqual({
      status: 'failed',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS,
    });

    failNext = false;
    await makeProcessor().processBatch(50);

    const row = await read(id);
    expect({ status: row.status, attempts: row.attempts }).toEqual({
      status: 'dead_lettered',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS,
    });
  });

  it('reclaims a repeatedly-abandoned row until it parks at the ceiling', async () => {
    // Models the claimant that dies between the claim and the completion — a
    // crash no test can produce by killing a process. After each poll the row is
    // put back into exactly the state a dead claimant leaves behind
    // ('processing', lease expired, `attempts` as the claim set it), and the poll
    // is repeated.
    //
    // `processOne` is given no payment to apply, so it completes without throwing
    // and `markFailed` never runs — asserted below. Every increment observed here
    // must therefore come from the CLAIM. Move the increment back into
    // `markFailed` and `seen` stays all-zeroes, so this test fails.
    const { id } = await seed({ paymentId: null });
    const repository = dataSource.getRepository(WebhookEvent);
    const processor = makeProcessor();
    const seen: number[] = [];

    for (let poll = 0; poll < WebhookEventProcessor.MAX_ATTEMPTS; poll++) {
      await processor.processBatch(50);
      const row = await read(id);
      seen.push(row.attempts);
      await repository.update(id, {
        status: 'processing',
        locked_at: new Date(Date.now() - STALE_MS),
      });
    }

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(applyCalls).toHaveLength(0); // processOne never threw ⇒ markFailed never ran

    await processor.processBatch(50); // the sweep parks the exhausted row

    const row = await read(id);
    expect({
      status: row.status,
      attempts: row.attempts,
      lockedAt: row.locked_at,
    }).toEqual({
      status: 'dead_lettered',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS,
      lockedAt: null,
    });
  });

  it('records why a row was parked when its claimant died without reporting anything', async () => {
    // A claimant that dies never reaches `markFailed`, so nothing has written an
    // error. The park still has to say why the row was set aside, otherwise a
    // dead-lettered row with an empty `error_message` is indistinguishable from a
    // bug in the parking itself.
    const { id } = await seed({
      status: 'processing',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS,
      lockedAgoMs: STALE_MS,
    });

    await makeProcessor().processBatch(50);

    const row = await read(id);
    expect({
      status: row.status,
      error: row.error_message,
      lockedAt: row.locked_at,
    }).toEqual({
      status: 'dead_lettered',
      error: 'abandoned by claimant',
      lockedAt: null,
    });
  });

  it('keeps the last real error when parking a row that failed before it was abandoned', async () => {
    // The park reason is a fallback, not an overwrite: a row that failed on an
    // earlier attempt must keep that message, because it is the only record of
    // what actually went wrong.
    const { id } = await seed({
      status: 'processing',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS,
      lockedAgoMs: STALE_MS,
    });
    await dataSource.getRepository(WebhookEvent).update(id, {
      error_message: 'gateway outcome failed',
    });

    await makeProcessor().processBatch(50);

    const row = await read(id);
    expect({ status: row.status, error: row.error_message }).toEqual({
      status: 'dead_lettered',
      error: 'gateway outcome failed',
    });
  });

  it('never re-claims a parked row', async () => {
    const { id } = await seed({
      status: 'dead_lettered',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS,
      paymentId: null,
    });

    await makeProcessor().processBatch(50);

    const row = await read(id);
    expect({
      status: row.status,
      attempts: row.attempts,
      processed: row.processed_at,
    }).toEqual({
      status: 'dead_lettered',
      attempts: WebhookEventProcessor.MAX_ATTEMPTS,
      processed: null,
    });
  });

  it('does not double-apply a payment that is already succeeded', async () => {
    // Drives the REAL PaymentsService, not the counting stub above: the property
    // under test is `applyGatewayOutcome`'s own idempotency guard — it returns
    // early when the payment is no longer PENDING — so a stub would assert the
    // stub instead of the guard.
    const orgId = randomUUID();
    const memberId = randomUUID();
    const invoiceId = randomUUID();
    const gatewayPaymentId = randomUUID();

    const branchId = randomUUID();
    await dataSource.getRepository(Organization).save({
      id: orgId, name: 'Replay Org', timezone: 'UTC', locale: 'en-US', currency: 'USD',
    });
    await dataSource.getRepository(Branch).save({
      id: branchId, organization_id: orgId, name: 'Replay Branch',
      address: '1 Replay Street', phone: '+10000000999',
    });
    await dataSource.getRepository(Member).save({
      id: memberId, organization_id: orgId, branch_id: branchId,
      global_uuid: randomUUID(), local_id: 9001,
      first_name: 'Replay', last_name: 'Member',
    });
    await dataSource.getRepository(Invoice).save({
      id: invoiceId, organization_id: orgId, member_id: memberId,
      invoice_number: `INV-REPLAY-${invoiceId.slice(0, 8)}`,
      invoice_date: new Date(), due_date: new Date(),
      subtotal: '10.00', total_amount: '10.00', status: 'paid',
    });
    await dataSource.getRepository(Payment).save({
      id: gatewayPaymentId, organization_id: orgId, member_id: memberId, invoice_id: invoiceId,
      payment_method: 'card', amount: '10.00', payment_date: new Date(),
      status: 'succeeded', retry_count: 1, idempotency_key: `idem-${gatewayPaymentId}`,
    });

    const { id: eventId } = await seed({ paymentId: gatewayPaymentId });

    const tenant = {
      getCurrentOrganizationId: async () => orgId,
      getRequestedOrganizationId: async () => orgId,
      requireOrganizationAccess: async () => orgId,
    } as unknown as TenantContextService;
    const outboxService = new OutboxService(dataSource.getRepository(OutboxEntity));
    const realPayments = new PaymentsService(
      dataSource.getRepository(Payment),
      dataSource.getRepository(Invoice),
      dataSource,
      tenant,
      outboxService,
      new InvoicesService(
        dataSource.getRepository(Invoice),
        dataSource.getRepository(InvoiceItem),
        dataSource.getRepository(Payment),
        dataSource.getRepository(TaxLine),
        dataSource.getRepository(CreditNote),
        dataSource,
        tenant,
        outboxService,
        new InvoiceNumberService(dataSource.getRepository(InvoiceNumberCounter), dataSource),
        new TaxRatesService(dataSource.getRepository(TaxRate), tenant),
      ),
      undefined as unknown as PaymentMethodsService,
      undefined as unknown as never,
    );

    const paymentRepository = dataSource.getRepository(Payment);
    const outboxRepository = dataSource.getRepository(OutboxEntity);

    const before = await paymentRepository.findOneOrFail({ where: { id: gatewayPaymentId } });
    const outboxBefore = await outboxRepository.count();

    const replay = new WebhookEventProcessor(
      dataSource,
      realPayments,
      refunds as unknown as RefundsService,
    );
    await replay.processBatch(50);

    const after = await paymentRepository.findOneOrFail({ where: { id: gatewayPaymentId } });
    expect({
      status: after.status,
      retryCount: after.retry_count,
      transactionId: after.transaction_id,
      gatewayStatus: after.gateway_status,
      gatewayResponse: after.gateway_response,
    }).toEqual({
      status: before.status,
      retryCount: before.retry_count,
      transactionId: before.transaction_id,
      gatewayStatus: before.gateway_status,
      gatewayResponse: before.gateway_response,
    });

    // Nothing downstream ran: no PaymentSucceeded re-emitted, and the event row
    // still completed normally.
    expect(await outboxRepository.count()).toBe(outboxBefore);
    expect((await read(eventId)).status).toBe('processed');
  });

  it('processes every row exactly once under two concurrent processBatch calls', async () => {
    const seeded = await Promise.all([seed(), seed(), seed(), seed(), seed(), seed()]);

    const processor = makeProcessor();
    await Promise.all([processor.processBatch(50), processor.processBatch(50)]);

    const rows = await Promise.all(seeded.map(({ id }) => read(id)));
    expect(rows.map((row) => row.status)).toEqual([
      'processed',
      'processed',
      'processed',
      'processed',
      'processed',
      'processed',
    ]);

    // The proof that no row was processed twice: each row's payment was applied
    // exactly once, however the two claimers happened to split the batch.
    for (const { paymentId } of seeded) {
      expect(applyCalls.filter((applied) => applied === paymentId)).toHaveLength(1);
    }
  });
});
