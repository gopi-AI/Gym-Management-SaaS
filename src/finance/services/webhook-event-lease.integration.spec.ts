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
 * prove. `payments` is a plain object with switchable functions, not a mock: it
 * sits downstream of the behaviour under test.
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
  });

  function makeProcessor(): WebhookEventProcessor {
    return new WebhookEventProcessor(
      dataSource,
      payments as unknown as PaymentsService,
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
      metadataOrganizationId?: string | null;
      eventType?: string;
    } = {},
  ): Promise<Seeded> {
    const id = randomUUID();
    const eventType = options.eventType ?? 'payment_intent.succeeded';
    // A real UUID, because the processors look the referenced row up by id and the
    // column is `uuid`: a `pay_<uuid>` placeholder fails Postgres's cast. The
    // adapter writes `payment.id` here (`stripe-payment-gateway.adapter.ts`), so a
    // UUID is also what Stripe actually delivers.
    const paymentId = options.paymentId === undefined ? randomUUID() : options.paymentId;
    const metadata: Record<string, string> = {};
    if (paymentId !== null) metadata.paymentId = paymentId;
    // DEF-13: the adapter writes `payment.organization_id` into the metadata, so a
    // fixture that omits it is the pre-DEF-13 shape rather than an impossible one.
    if (options.metadataOrganizationId) metadata.organizationId = options.metadataOrganizationId;
    const repository = dataSource.getRepository(WebhookEvent);

    await repository.save({
      id,
      provider: 'stripe',
      provider_event_id: `evt_${id}`,
      event_type: eventType,
      payload: {
        id: `evt_${id}`,
        type: eventType,
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

  /**
   * Bounded poll used to synchronize with a claimant that is deliberately held
   * open. It is a synchronization device, never an assertion about timing: the
   * outcome is always asserted on the database state after both claimants finish.
   */
  async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return predicate();
  }

  /**
   * The REAL `PaymentsService`, wired to the real `DataSource`. Used where the
   * property under test is one of its own guards — the `PENDING` early return in
   * `applyGatewayOutcome` — rather than the processor's, so a stub would assert
   * the stub instead of the guard.
   */
  function makeRealPayments(orgId: string): PaymentsService {
    const tenant = {
      getCurrentOrganizationId: async () => orgId,
      getRequestedOrganizationId: async () => orgId,
      requireOrganizationAccess: async () => orgId,
    } as unknown as TenantContextService;
    const outboxService = new OutboxService(dataSource.getRepository(OutboxEntity));
    return new PaymentsService(
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

  /**
   * org -> branch -> member -> invoice -> payment, the minimum chain the FKs
   * demand before a payment row can exist. Returns the ids so a test can assert
   * the webhook row was attributed to `orgId` specifically, rather than merely to
   * something non-null.
   */
  async function seedPaymentGraph(): Promise<{ orgId: string; paymentId: string; invoiceId: string }> {
    const orgId = randomUUID();
    const branchId = randomUUID();
    const memberId = randomUUID();
    const invoiceId = randomUUID();
    const paymentId = randomUUID();

    await dataSource.getRepository(Organization).save({
      id: orgId, name: 'Attribution Org', timezone: 'UTC', locale: 'en-US', currency: 'USD',
    });
    await dataSource.getRepository(Branch).save({
      id: branchId, organization_id: orgId, name: 'Attribution Branch',
      address: '2 Attribution Street', phone: '+10000000888',
    });
    await dataSource.getRepository(Member).save({
      id: memberId, organization_id: orgId, branch_id: branchId,
      global_uuid: randomUUID(), local_id: Math.floor(Math.random() * 1_000_000_000),
      first_name: 'Attribution', last_name: 'Member',
    });
    await dataSource.getRepository(Invoice).save({
      id: invoiceId, organization_id: orgId, member_id: memberId,
      invoice_number: `INV-ATTR-${invoiceId.slice(0, 8)}`,
      invoice_date: new Date(), due_date: new Date(),
      subtotal: '10.00', total_amount: '10.00', status: 'pending',
    });
    await dataSource.getRepository(Payment).save({
      id: paymentId, organization_id: orgId, member_id: memberId, invoice_id: invoiceId,
      payment_method: 'card', amount: '10.00', payment_date: new Date(),
      status: 'pending', idempotency_key: `idem-${paymentId}`,
    });

    return { orgId, paymentId, invoiceId };
  }

  it('attributes a payment event to the organization of the payment it names (DEF-04)', async () => {
    const { orgId, paymentId } = await seedPaymentGraph();
    const { id: eventId } = await seed({ paymentId });

    await makeProcessor().processBatch(50);

    const row = await read(eventId);
    expect({ status: row.status, org: row.organization_id }).toEqual({
      status: 'processed',
      org: orgId,
    });
  });

  it('records a charge.refunded event with no state change (DEF-14)', async () => {
    // The shape Stripe actually sends: a Charge whose metadata is the
    // `{ paymentId }` the adapter set on the PaymentIntent-created charge — never a
    // `refundId`. With the refund branch and its allowlist entry deleted (owner
    // ruling, 2026-10-04) this event changes nothing; re-adding the entry would
    // route it down the PAYMENT path and settle the payment below.
    const { paymentId, invoiceId } = await seedPaymentGraph();
    const { id: eventId } = await seed({ paymentId, eventType: 'charge.refunded' });

    // Scoped to this event's own aggregate — its invoice is the `correlationId`
    // its payment outcome would carry. A global outbox count races the other
    // integration suites.
    const outboxBefore = await dataSource.getRepository(OutboxEntity).count({
      where: { correlationId: invoiceId },
    });
    await makeProcessor().processBatch(50);

    const row = await read(eventId);
    expect({ status: row.status, org: row.organization_id, attempts: row.attempts }).toEqual({
      status: 'processed',
      org: null,
      attempts: 1,
    });
    // Scoped to the seeded payment: a batch claim may also pick up a row an
    // earlier test left claimable, and only THIS payment may not be touched.
    expect(applyCalls.filter((appliedTo) => appliedTo === paymentId)).toHaveLength(0);
    expect(
      await dataSource.getRepository(OutboxEntity).count({ where: { correlationId: invoiceId } }),
    ).toBe(outboxBefore);
    const payment = await dataSource.getRepository(Payment).findOneOrFail({ where: { id: paymentId } });
    expect(payment.status).toBe('pending');
  });

  it('parks an event whose metadata organization disagrees with the payment row (DEF-13)', async () => {
    const { orgId, paymentId, invoiceId } = await seedPaymentGraph();
    const mismatchOrgId = randomUUID();
    const { id: eventId } = await seed({ paymentId, metadataOrganizationId: mismatchOrgId });

    // Scoped to this event's own aggregate — its invoice is the `correlationId`
    // its payment outcome would carry.
    const outboxBefore = await dataSource.getRepository(OutboxEntity).count({
      where: { correlationId: invoiceId },
    });
    await makeProcessor().processBatch(50);

    const row = await read(eventId);
    expect({ status: row.status, attempts: row.attempts, org: row.organization_id }).toEqual({
      status: 'dead_lettered',
      attempts: 1,
      org: null,
    });
    expect(row.error_message).toContain(mismatchOrgId);
    expect(row.error_message).toContain(orgId);
    expect(applyCalls.filter((appliedTo) => appliedTo === paymentId)).toHaveLength(0);
    expect(
      await dataSource.getRepository(OutboxEntity).count({ where: { correlationId: invoiceId } }),
    ).toBe(outboxBefore);
    const payment = await dataSource.getRepository(Payment).findOneOrFail({ where: { id: paymentId } });
    expect(payment.status).toBe('pending');

    // Parked is terminal: neither the next claim nor the parked sweep touches it.
    await makeProcessor().processBatch(50);
    const after = await read(eventId);
    expect({ status: after.status, attempts: after.attempts }).toEqual({
      status: 'dead_lettered',
      attempts: 1,
    });
  });

  it('leaves organization_id null for an event naming no payment or refund (DEF-04)', async () => {
    const { id: eventId } = await seed({ paymentId: null });

    await makeProcessor().processBatch(50);

    const row = await read(eventId);
    expect({ status: row.status, org: row.organization_id }).toEqual({
      status: 'processed',
      org: null,
    });
  });

  it('records an unhandled event type with no state change (DEF-06)', async () => {
    const { paymentId, invoiceId } = await seedPaymentGraph();
    const { id: eventId } = await seed({ paymentId, eventType: 'customer.created' });

    // Scoped to this event's own aggregate — the invoice is the `correlationId`
    // its payment outcomes would carry. A global outbox count races the other
    // integration suites, which write `shared.outbox` in parallel.
    const outboxBefore = await dataSource.getRepository(OutboxEntity).count({
      where: { correlationId: invoiceId },
    });
    await makeProcessor().processBatch(50);

    const row = await read(eventId);
    expect({ status: row.status, org: row.organization_id, attempts: row.attempts }).toEqual({
      status: 'processed',
      org: null,
      attempts: 1,
    });

    // Nothing downstream ran: no gateway call, no outbox row for this aggregate,
    // payment untouched.
    expect(applyCalls).toHaveLength(0);
    expect(
      await dataSource.getRepository(OutboxEntity).count({ where: { correlationId: invoiceId } }),
    ).toBe(outboxBefore);
    const payment = await dataSource.getRepository(Payment).findOneOrFail({ where: { id: paymentId } });
    expect({ status: payment.status, retryCount: payment.retry_count }).toEqual({
      status: 'pending',
      retryCount: 0,
    });
  });

  it('does not treat charge.succeeded as a successful payment (DEF-06)', async () => {
    // The substring test matched this type; the allowlist does not, because this
    // processor only applies the `payment_intent.*` pair.
    const { paymentId, invoiceId } = await seedPaymentGraph();
    const { id: eventId } = await seed({ paymentId, eventType: 'charge.succeeded' });

    // Scoped to this event's own aggregate, as above.
    const outboxBefore = await dataSource.getRepository(OutboxEntity).count({
      where: { correlationId: invoiceId },
    });
    await makeProcessor().processBatch(50);

    const row = await read(eventId);
    expect({ status: row.status, org: row.organization_id }).toEqual({
      status: 'processed',
      org: null,
    });
    expect(applyCalls).toHaveLength(0);
    expect(
      await dataSource.getRepository(OutboxEntity).count({ where: { correlationId: invoiceId } }),
    ).toBe(outboxBefore);
    const payment = await dataSource.getRepository(Payment).findOneOrFail({ where: { id: paymentId } });
    expect(payment.status).toBe('pending');
  });

  it('treats a non-UUID reference as unreferenced: processed, no retry (DEF-06)', async () => {
    // Without the UUID guard this value reaches a `uuid` column lookup, the event
    // fails, and DEF-05 retries it to the ceiling and parks it.
    const { id: eventId } = await seed({ paymentId: 'not-a-uuid' });

    await makeProcessor().processBatch(50);

    const row = await read(eventId);
    expect({
      status: row.status,
      attempts: row.attempts,
      org: row.organization_id,
      processed: row.processed_at !== null,
    }).toEqual({ status: 'processed', attempts: 1, org: null, processed: true });
    expect(applyCalls).toHaveLength(0);
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

    const realPayments = makeRealPayments(orgId);

    const paymentRepository = dataSource.getRepository(Payment);
    const outboxRepository = dataSource.getRepository(OutboxEntity);

    const before = await paymentRepository.findOneOrFail({ where: { id: gatewayPaymentId } });
    // Scoped to this payment's own aggregate — its invoice is the `correlationId`
    // its outcomes carry. A global count races the other integration suites.
    const outboxBefore = await outboxRepository.count({ where: { correlationId: invoiceId } });

    const replay = new WebhookEventProcessor(dataSource, realPayments);
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

    // Nothing downstream ran: no PaymentSucceeded re-emitted for this invoice,
    // and the event row still completed normally.
    expect(await outboxRepository.count({ where: { correlationId: invoiceId } })).toBe(outboxBefore);
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

  /**
   * DEF-12: the guards behind the lease, driven through the REAL processor.
   *
   * The lease is a timeout, not a fencing token, so a row whose work outlives
   * `WEBHOOK_LOCK_DURATION_MS` can in principle be reclaimed by a later poll while
   * the first claimant is still running. These tests assert the property that
   * protects the money path — the outcome is applied exactly once — rather than
   * reading the guards; the backlog entry records which guard carries it, measured
   * by mutation.
   */
  it('applies a payment exactly once when two claimants run processOne concurrently (DEF-12)', async () => {
    const paymentId = randomUUID();
    // Already past its lease: this is the reclaim window DEF-12 describes.
    const { id } = await seed({ status: 'processing', attempts: 1, lockedAgoMs: STALE_MS, paymentId });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const applied: string[] = [];
    payments = {
      applyGatewayOutcome: async (_manager: unknown, appliedTo: string) => {
        applied.push(appliedTo);
        if (appliedTo === paymentId) await gate; // the first claimant stays inside its transaction
      },
    } as unknown as Pick<PaymentsService, 'applyGatewayOutcome'>;

    const processor = makeProcessor();
    const first = (processor as any).processOne(id) as Promise<void>;
    expect(await waitFor(() => applied.includes(paymentId))).toBe(true);

    // The second claimant reaches the row while the first is still working. Only
    // the row lock and the `processed` early return stand between it and a second
    // application.
    const second = (processor as any).processOne(id) as Promise<void>;
    await waitFor(() => applied.filter((appliedTo) => appliedTo === paymentId).length >= 2);
    release();
    await Promise.all([first, second]);

    expect(applied.filter((appliedTo) => appliedTo === paymentId)).toHaveLength(1);
    expect((await read(id)).status).toBe('processed');
  });

  it('does not reclaim a row an active claimant still holds, even with the lease lapsed (DEF-12)', async () => {
    const paymentId = randomUUID();
    const { id } = await seed({ status: 'processing', attempts: 1, lockedAgoMs: STALE_MS, paymentId });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const applied: string[] = [];
    payments = {
      applyGatewayOutcome: async (_manager: unknown, appliedTo: string) => {
        applied.push(appliedTo);
        if (appliedTo === paymentId) await gate;
      },
    } as unknown as Pick<PaymentsService, 'applyGatewayOutcome'>;

    const processor = makeProcessor();
    const first = (processor as any).processOne(id) as Promise<void>;
    expect(await waitFor(() => applied.includes(paymentId))).toBe(true);

    // The second claimant runs the REAL claim while the first is mid-transaction:
    // the row is claimable by every predicate except that it is locked, and
    // `FOR UPDATE SKIP LOCKED` passes over it. It is started without awaiting,
    // because without that lock the claimant reaches the payment stub and blocks
    // there — a deadlock the assertions below would otherwise report as a timeout.
    const claimer = processor.processBatch(50);
    await waitFor(() => applied.filter((appliedTo) => appliedTo === paymentId).length >= 2);

    const during = await read(id);
    const observed = { status: during.status, attempts: during.attempts };

    release();
    await Promise.all([claimer, first]);

    // Everything is asserted after both claimants have finished, so the failure
    // is the state they produced rather than a hung test.
    expect(observed).toEqual({ status: 'processing', attempts: 1 });
    const after = await read(id);
    expect({ status: after.status, attempts: after.attempts }).toEqual({
      status: 'processed',
      attempts: 1,
    });
    expect(applied.filter((appliedTo) => appliedTo === paymentId)).toHaveLength(1);
  });

  it('leaves an already-processed event alone on the next poll (DEF-12)', async () => {
    const { paymentId } = await seedPaymentGraph();
    const { id } = await seed({ paymentId });

    const processor = makeProcessor();
    await processor.processBatch(50);
    const first = await read(id);

    await processor.processBatch(50);

    const second = await read(id);
    expect({
      status: second.status,
      attempts: second.attempts,
      processedAt: second.processed_at?.toISOString(),
    }).toEqual({
      status: 'processed',
      attempts: first.attempts,
      processedAt: first.processed_at?.toISOString(),
    });
    expect(applyCalls.filter((appliedTo) => appliedTo === paymentId)).toHaveLength(1);
  });

  it('leaves a payment untouched when the same gateway outcome is applied a second time (DEF-12)', async () => {
    // The property under test is `applyGatewayOutcome`'s own guard — the early
    // return once the payment is no longer `pending` — so this drives the REAL
    // service, in two separate transactions, rather than the counting stub.
    const { orgId, paymentId, invoiceId } = await seedPaymentGraph();
    const realPayments = makeRealPayments(orgId);
    const paymentRepository = dataSource.getRepository(Payment);
    const outboxRepository = dataSource.getRepository(OutboxEntity);
    const outcome = {
      succeeded: true,
      transactionId: `pi_${paymentId}`,
      gatewayReference: `pi_${paymentId}`,
      gatewayStatus: 'succeeded',
      gatewayResponse: '{}',
    };

    await dataSource.transaction((manager) => realPayments.applyGatewayOutcome(manager, paymentId, outcome));
    const afterFirst = await paymentRepository.findOneOrFail({ where: { id: paymentId } });
    // Scoped to this payment's own aggregate — its invoice is the `correlationId`
    // its outcome carries. A global count races the other integration suites.
    const outboxAfterFirst = await outboxRepository.count({ where: { correlationId: invoiceId } });
    expect(afterFirst.status).toBe('succeeded');

    await dataSource.transaction((manager) => realPayments.applyGatewayOutcome(manager, paymentId, outcome));
    const afterSecond = await paymentRepository.findOneOrFail({ where: { id: paymentId } });

    expect({
      status: afterSecond.status,
      retryCount: afterSecond.retry_count,
      transactionId: afterSecond.transaction_id,
      gatewayStatus: afterSecond.gateway_status,
      gatewayResponse: afterSecond.gateway_response,
    }).toEqual({
      status: afterFirst.status,
      retryCount: afterFirst.retry_count,
      transactionId: afterFirst.transaction_id,
      gatewayStatus: afterFirst.gateway_status,
      gatewayResponse: afterFirst.gateway_response,
    });
    expect(await outboxRepository.count({ where: { correlationId: invoiceId } })).toBe(outboxAfterFirst);
  });
});
