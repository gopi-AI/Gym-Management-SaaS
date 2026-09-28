/**
 * End-to-end regression for the P3-04b defect: an active membership discount
 * never reached an invoice.
 *
 * WHY THIS EXISTS ALONGSIDE THE MOCKED SPEC NEXT TO IT
 * `memberships.service.spec.ts` pins the discount arithmetic, but a mock is free
 * to hand `renewOne` whatever the test wants — so it could not detect that
 * `renewOne` never looked a discount up at all. This spec drives the real
 * `MembershipsService` -> real `InvoicesService` -> real SQL path against a
 * migrated schema and asserts what money follows: the persisted invoice total,
 * the payment amount, the `FINANCE_INVOICE_DISCOUNTS` snapshot, and the
 * `MembershipRenewed.v1` row actually written to the outbox table.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/memberships/services/memberships-discount-renewal
 * The database is selected exactly as `src/data-source.ts` selects it and MUST
 * already be migrated, with the same variables exported:
 *   DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *   DB_DATABASE=<scratch> npm run migration:run
 * Jest does not load `.env` (jest.config.js declares no setupFiles), so the
 * failure mode to avoid is assuming the variables are "already in the
 * environment": with only `DB_DATABASE` set, `src/data-source.ts` falls back to
 * `localhost:5432 postgres/postgres`, and a bare
 * `RUN_DB_INTEGRATION=1 npx jest src/memberships/services/memberships-discount-renewal`
 * fails every test from `beforeAll` with `Ident authentication failed for user
 * "postgres"` (SQLSTATE 28000) on any Postgres that does not accept those
 * defaults. Pass all five explicitly. Without `RUN_DB_INTEGRATION=1` the block
 * reports as SKIPPED, so the default hermetic `npm test` never needs a database.
 *
 * Point it at a THROWAWAY database. Every row it writes belongs to one freshly
 * generated organization and is deleted in `afterAll`, but the clean-up is a
 * courtesy, not a substitute for an isolated schema.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { MembershipsService } from './memberships.service';
import { Membership } from '../entities/membership.entity';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { MembershipHistory } from '../entities/membership-history.entity';
import { MembershipDiscount } from '../entities/membership-discount.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Member } from '../../members/entities/member.entity';
import { Invoice } from '../../finance/entities/invoice.entity';
import { InvoiceItem } from '../../finance/entities/invoice-item.entity';
import { InvoiceDiscount } from '../../finance/entities/invoice-discount.entity';
import { InvoiceNumberCounter } from '../../finance/entities/invoice-number-counter.entity';
import { Payment } from '../../finance/entities/payment.entity';
import { TaxLine } from '../../finance/entities/tax-line.entity';
import { TaxRate } from '../../finance/entities/tax-rate.entity';
import { CreditNote } from '../../finance/entities/credit-note.entity';
import { InvoicesService } from '../../finance/services/invoices.service';
import { InvoiceNumberService } from '../../finance/services/invoice-number.service';
import { TaxRatesService } from '../../finance/services/tax-rates.service';
import { PaymentsService } from '../../finance/services/payments.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { INVOICE_STATUS, PAYMENT_STATUS } from '../../finance/finance.constants';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

// One instant of "now" for this suite: the membership is renewed before it.
const TODAY = '2026-02-01';
const PLAN_PRICE = '100.00';
const DISCOUNT_AMOUNT = '20.00';

describeIntegration('MembershipsService renewal applies an active discount (real Postgres)', () => {
  let dataSource: DataSource;
  let service: MembershipsService;
  let invoicesService: InvoicesService;
  let attemptWithSavedMethod: jest.Mock;

  const ids = {
    organization: randomUUID(),
    branch: randomUUID(),
    member: randomUUID(),
    plan: randomUUID(),
    membership: randomUUID(),
    discount: randomUUID(),
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      // Same resolution rule as `src/data-source.ts` (a glob over the entity
      // files), so this spec can never drift from the entities the application
      // actually maps — an explicit list silently breaks the moment a relation
      // such as `Member#identifiers` is added.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();
  }, 30000);

  beforeAll(async () => {
    await dataSource.getRepository(Organization).save({
      id: ids.organization, name: 'Discount E2E Org', timezone: 'UTC', locale: 'en-US', currency: 'USD',
    });
    await dataSource.getRepository(Branch).save({
      id: ids.branch, organization_id: ids.organization,
      name: 'Main', address: '1 Test Street', phone: '+10000000000',
    });
    await dataSource.getRepository(Member).save({
      id: ids.member, organization_id: ids.organization, branch_id: ids.branch,
      global_uuid: randomUUID(), local_id: 1,
      first_name: 'Discount', last_name: 'Renewal', tax_exempt: false,
    });
    await dataSource.getRepository(MembershipPlan).save({
      id: ids.plan, organization_id: ids.organization, name: 'Monthly Standard',
      price: PLAN_PRICE, currency: 'USD', billing_period: 'monthly', duration_days: 30,
    });
    await dataSource.getRepository(Membership).save({
      id: ids.membership, organization_id: ids.organization, member_id: ids.member,
      plan_id: ids.plan, branch_id: ids.branch, status: 'active',
      start_date: '2026-01-01', end_date: '2026-02-01', renewal_date: '2026-01-31',
      price_at_signup: PLAN_PRICE, currency_at_signup: 'USD',
    });
    // The row the defect left inert: what `POST /v1/memberships/:id/discount`
    // writes for an ALREADY EXISTING membership. Open-ended (`ends_at: null`) so
    // it is in force at renewal.
    await dataSource.getRepository(MembershipDiscount).save({
      id: ids.discount, membership_id: ids.membership, organization_id: ids.organization,
      discount_type: 'percentage', amount: DISCOUNT_AMOUNT,
      starts_at: new Date('2026-01-01T00:00:00.000Z'), ends_at: null,
    });

    const tenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      requireOrganizationAccess: jest.fn().mockResolvedValue(ids.organization),
      getCurrentUserId: jest.fn().mockResolvedValue(randomUUID()),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    } as unknown as TenantContextService;

    const outboxService = new OutboxService(dataSource.getRepository(OutboxEntity));
    const invoiceNumberService = new InvoiceNumberService(
      dataSource.getRepository(InvoiceNumberCounter),
      dataSource,
    );
    const taxRatesService = new TaxRatesService(dataSource.getRepository(TaxRate), tenantContext);
    invoicesService = new InvoicesService(
      dataSource.getRepository(Invoice),
      dataSource.getRepository(InvoiceItem),
      dataSource.getRepository(Payment),
      dataSource.getRepository(TaxLine),
      dataSource.getRepository(CreditNote),
      dataSource,
      tenantContext,
      outboxService,
      invoiceNumberService,
      taxRatesService,
    );

    // A real gateway is out of scope: a successful charge is simulated by marking
    // the created payment row succeeded, which is all `renewOne` re-reads for.
    attemptWithSavedMethod = jest.fn(async (payment: Payment) => {
      await dataSource.getRepository(Payment).update(
        { id: payment.id },
        { status: PAYMENT_STATUS.SUCCEEDED, retry_count: 1 },
      );
      return { status: PAYMENT_STATUS.SUCCEEDED, retryCount: 1, exhausted: false };
    });
    const paymentsService = { attemptWithSavedMethod } as unknown as PaymentsService;

    service = new MembershipsService(
      dataSource.getRepository(Membership),
      dataSource.getRepository(MembershipPlan),
      dataSource.getRepository(MembershipHistory),
      dataSource.getRepository(MembershipDiscount),
      dataSource,
      tenantContext,
      outboxService,
      invoicesService,
      paymentsService,
    );
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const org = { organization_id: ids.organization };
    // Children first. Every seeded row carries this suite's own organization, so
    // this sweep can never touch pre-existing data.
    await dataSource.getRepository(InvoiceDiscount).delete(org);
    await dataSource.getRepository(TaxLine).delete(org);
    await dataSource.getRepository(InvoiceItem).delete(org);
    await dataSource.getRepository(Payment).delete(org);
    await dataSource.getRepository(Invoice).delete(org);
    await dataSource.getRepository(MembershipHistory).delete(org);
    await dataSource.getRepository(MembershipDiscount).delete(org);
    await dataSource.getRepository(Membership).delete(org);
    await dataSource.getRepository(MembershipPlan).delete(org);
    await dataSource.getRepository(Member).delete(org);
    await dataSource.getRepository(Branch).delete(org);
    await dataSource.getRepository(InvoiceNumberCounter).delete(org);
    // The outbox has no organization column, so its rows are identified by the
    // organization id embedded in the serialized envelope.
    const outboxRepository = dataSource.getRepository(OutboxEntity);
    const outboxRows = await outboxRepository
      .createQueryBuilder('outbox')
      .where('outbox.payload LIKE :org', { org: `%${ids.organization}%` })
      .getMany();
    if (outboxRows.length > 0) {
      await outboxRepository.delete(outboxRows.map((row) => row.id));
    }
    await dataSource.getRepository(Organization).delete({ id: ids.organization });
    await dataSource.destroy();
  }, 30000);

  it('bills the renewal at the discounted total and writes the discount snapshot', async () => {
    const result = await service.renewDueMemberships({ today: TODAY, limit: 10 });

    // `membershipIds` only receives memberships whose payment succeeded, so this
    // is the renewal actually completing rather than merely being scanned.
    expect(result.membershipIds).toContain(ids.membership);

    const invoice = await dataSource.getRepository(Invoice).findOne({
      where: { membership_id: ids.membership },
    });
    expect(invoice).not.toBeNull();
    // 100.00 less 20 % = 80.00. No tax rates are configured for this
    // organization, so tax stays 0.00 and the discount shows up in the total.
    expect(invoice!.status).toBe(INVOICE_STATUS.SENT);
    expect(invoice!.subtotal).toBe('80.00');
    expect(invoice!.tax_amount).toBe('0.00');
    expect(invoice!.total_amount).toBe('80.00');

    const items = await dataSource.getRepository(InvoiceItem).find({
      where: { invoice_id: invoice!.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0].unit_price).toBe('80.00');
    expect(items[0].line_total).toBe('80.00');

    // The immutable audit row the fix makes reachable.
    const snapshot = await dataSource.getRepository(InvoiceDiscount).findOne({
      where: { invoice_id: invoice!.id },
    });
    expect(snapshot).toMatchObject({
      organization_id: ids.organization,
      membership_discount_id: ids.discount,
      discount_type: 'percentage',
      amount: DISCOUNT_AMOUNT,
      applied_amount: DISCOUNT_AMOUNT,
    });

    // What was charged follows the discounted total, not the plan price.
    const payment = await dataSource.getRepository(Payment).findOne({
      where: { invoice_id: invoice!.id },
    });
    expect(payment).toMatchObject({ amount: '80.00', status: PAYMENT_STATUS.SUCCEEDED });
    expect(attemptWithSavedMethod).toHaveBeenCalledTimes(1);

    // And the term was extended, i.e. the renewal ran to completion.
    const membership = await dataSource.getRepository(Membership).findOne({
      where: { id: ids.membership },
    });
    expect(membership!.end_date).toBe('2026-03-03');

    // The renewal event, proven end-to-end rather than only against a mock: a
    // single row must exist in the outbox, written on the same transaction as
    // everything above, carrying the envelope and payload that the mocked spec
    // pins field-for-field (`memberships.service.spec.ts:341`).
    const eventRows = await dataSource.getRepository(OutboxEntity).find({
      where: { eventType: 'MembershipRenewed' },
    });
    expect(eventRows).toHaveLength(1);
    // Denormalized columns the poller/claim queries read, kept in sync with the
    // serialized envelope by `OutboxService.saveEventEnvelope`.
    expect(eventRows[0].correlationId).toBe(ids.membership);
    expect(eventRows[0].processed).toBe(false);

    const envelope = JSON.parse(eventRows[0].payload) as {
      eventId: string;
      eventType: string;
      eventVersion: string;
      organizationId: string;
      occurredAt: string;
      correlationId: string;
      causationId?: string;
      payload: Record<string, unknown>;
    };
    expect(envelope.eventType).toBe('MembershipRenewed');
    expect(envelope.eventVersion).toBe('v1');
    expect(envelope.organizationId).toBe(ids.organization);
    expect(envelope.correlationId).toBe(ids.membership);
    expect(envelope.eventId).toEqual(expect.any(String));
    expect(envelope.occurredAt).toEqual(expect.any(String));
    // The renewal emit path passes no causationId, so the key must be absent
    // rather than present-and-undefined.
    expect(envelope.causationId).toBeUndefined();
    // Field-for-field with `MembershipRenewedPayload`
    // (packages/contracts/src/events/membership.events.ts:17-22).
    expect(envelope.payload).toEqual({
      membershipId: ids.membership,
      renewalDate: '2026-01-31',     // the cycle that was settled
      nextPaymentDate: '2026-03-03', // the advanced end/renewal date
      renewalFee: '80.00',           // what was charged — the DISCOUNTED total
    });
  }, 30000);
});
