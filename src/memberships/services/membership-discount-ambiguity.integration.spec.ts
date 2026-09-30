/**
 * Regression spec for the duplicate-discount-row defect found while hardening
 * B2. `MembershipsService.addDiscount` used to guard on a SINGLE un-ordered read
 * —
 *
 *   const existing = await repository.findOne({ where: { membership_id: id, organization_id } });
 *   if (existing && (!existing.ends_at || existing.ends_at > new Date())) throw Conflict...
 *
 * — i.e. it assumed a membership can only ever own one discount row. Nothing
 * enforces that: `UQ_membership_discounts_one_active` is a PARTIAL unique index
 * on `(membership_id) WHERE ends_at IS NULL`, so a row carrying an `ends_at` is
 * invisible to it, two rows per membership are legal, and a
 * create-bounded/create-again cycle through the public API leaves exactly that
 * state. With an expired row and an active row both present, Postgres returned
 * the EXPIRED one (the plan carries no Sort node, so heap order decides), the
 * TypeScript-side activity test evaluated false, and a second active discount
 * was accepted on a membership that already had one — the price the member is
 * charged then depended on physical row order.
 *
 * The guard now pushes the validity window into the query
 * (`starts_at <= now AND (ends_at IS NULL OR ends_at > now)` — the same
 * predicate `renewOne` and `create()` use), so the database, not the service,
 * decides which row is inspected.
 *
 * FIXED (D2, 2026-10-01): `renewOne`, `create()` and `addDiscount` now apply an
 * explicit `ORDER BY` — `MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER` (`starts_at DESC,
 * created_at DESC, id ASC`). Two in-force rows remain legal (the partial index
 * stops only two open-ended ones), so WHICH one a caller sees must be decided by
 * that key, not by physical row order. Cases 5-6 pin the key on real Postgres.
 *
 * WHAT THIS SPEC ASSERTS
 * 1. The raw un-ordered read the old guard issued is kept as live evidence
 *    (printed; asserted only as "a row came back" — WHICH row is plan-dependent
 *    and the fix no longer depends on the answer).
 * 2. The guard's own predicate selects the in-force row, and the real service,
 *    driven against real Postgres, rejects with ConflictException and writes
 *    nothing.
 * 3. The legitimate create/expire/create cycle still works: with only an expired
 *    row present a new discount is accepted.
 * 4. The partial unique index remains the last line of defence for
 *    `ends_at IS NULL`, and a collision on it — invisible to the belt check when
 *    the existing row is future-dated — is translated into the guard's own 409
 *    rather than escaping as an unhandled driver error.
 * 5. Overlapping in-force rows are ordered by the tie-break: the latest
 *    `starts_at` wins, then the latest `created_at`.
 * 6. With `starts_at` AND `created_at` tied, `id ASC` decides (the assumption
 *    recorded on the service constant).
 *
 * RUNNING IT — same pattern as `memberships-discount-renewal.integration.spec.ts`
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/memberships/services/membership-discount-ambiguity
 * The database is selected exactly as `src/data-source.ts` selects it and MUST
 * already be migrated, with the same variables exported:
 *   DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *   DB_DATABASE=<scratch> npm run migration:run
 * Jest does not load `.env` (jest.config.js declares no setupFiles), so the
 * failure mode to avoid is assuming the variables are "already in the
 * environment": with only `DB_DATABASE` set, `src/data-source.ts` falls back to
 * `localhost:5432 postgres/postgres`, and a bare
 * `RUN_DB_INTEGRATION=1 npx jest src/memberships/services/membership-discount-ambiguity`
 * fails every test from `beforeAll` with `Ident authentication failed for user
 * "postgres"` (SQLSTATE 28000) on any Postgres that does not accept those
 * defaults. Pass all five explicitly. Without `RUN_DB_INTEGRATION=1` the block
 * reports as SKIPPED, so the hermetic `jest src/memberships` never needs a
 * database. Point it at a THROWAWAY database — every row it writes belongs to
 * one freshly generated organization and is deleted in `afterAll`.
 *
 * KNOWN RESIDUAL (documented, not silently widened): a row whose `starts_at` is
 * in the FUTURE with `ends_at IS NULL` is not in force now, so this window
 * predicate skips it and the belt check passes. A second open-ended discount
 * attempted against such a row is stopped by `UQ_membership_discounts_one_active`
 * (SQLSTATE 23505), and `addDiscount` translates that into the guard's own
 * ConflictException — a controlled 409, not a raw driver error. The predicate was
 * deliberately NOT widened to cover this case: requiring a not-yet-ended row with
 * no `starts_at` bound would block legitimate future-dated scheduling whenever any
 * unexpired row exists. Tests 2 and 4 below pin the index and the 409.
 */
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { DataSource, IsNull, LessThanOrEqual, MoreThan, Or } from 'typeorm';
import { MembershipsService, MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER } from './memberships.service';
import { Membership } from '../entities/membership.entity';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { MembershipHistory } from '../entities/membership-history.entity';
import { MembershipDiscount } from '../entities/membership-discount.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Member } from '../../members/entities/member.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { InvoicesService } from '../../finance/services/invoices.service';
import { PaymentsService } from '../../finance/services/payments.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration('MembershipDiscount duplicate guard (real Postgres)', () => {
  let dataSource: DataSource;
  let service: MembershipsService;
  const ids = {
    organization: randomUUID(),
    branch: randomUUID(),
    member: randomUUID(),
    // Carries BOTH row shapes: an expired one and an in-force one.
    membership: randomUUID(),
    expiredDiscount: randomUUID(),
    activeDiscount: randomUUID(),
    // Carries an expired row only — the legitimate replacement path.
    expiredOnlyMembership: randomUUID(),
    expiredOnlyDiscount: randomUUID(),
    // Carries one open-ended row that starts in 2099: legal, and outside the
    // guard's window predicate, so only the partial unique index can stop a
    // second open-ended row here.
    futureOpenEndedMembership: randomUUID(),
    futureOpenEndedDiscount: randomUUID(),
    // Two overlapping in-force rows: `starts_at` ties, `created_at` breaks it.
    orderedMembership: randomUUID(),
    // Two overlapping in-force rows tied on `starts_at` AND `created_at`.
    tieIdMembership: randomUUID(),
  };

  // The two legal rows, in the order production would create them: the
  // time-bounded one first (it later expires), the open-ended one second.
  const expiredRow = {
    id: ids.expiredDiscount,
    discount_type: 'fixed' as const,
    amount: '10.00',
    starts_at: new Date('2026-01-01T00:00:00.000Z'),
    ends_at: new Date('2026-02-01T00:00:00.000Z'),
  };
  const activeRow = {
    id: ids.activeDiscount,
    discount_type: 'percentage' as const,
    amount: '25.00',
    starts_at: new Date('2026-02-01T00:00:00.000Z'),
    ends_at: null,
  };
  // Scheduled and never-ending: legal, and deliberately outside the window
  // predicate (`starts_at <= now`), which is what makes this row the one shape
  // the belt check cannot see.
  const futureOpenEndedRow = {
    id: ids.futureOpenEndedDiscount,
    discount_type: 'fixed' as const,
    amount: '3.00',
    starts_at: new Date('2099-01-01T00:00:00.000Z'),
    ends_at: null,
  };

  // Deterministic winners for the tie-break fixture, ordered by the service's
  // shared key: `starts_at DESC, created_at DESC, id ASC`.
  const ORDERED_WINNER = '10000000-0000-4000-8000-000000000002';
  const TIE_ID_WINNER = '40000000-0000-4000-8000-000000000001';

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
      // actually maps.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    await dataSource.getRepository(Organization).save({
      id: ids.organization, name: 'Discount Ambiguity Org', timezone: 'UTC', locale: 'en-US', currency: 'USD',
    });
    await dataSource.getRepository(Branch).save({
      id: ids.branch, organization_id: ids.organization,
      name: 'Main', address: '1 Test Street', phone: '+10000000000',
    });
    await dataSource.getRepository(Member).save({
      id: ids.member, organization_id: ids.organization, branch_id: ids.branch,
      global_uuid: randomUUID(), local_id: 1,
      first_name: 'Discount', last_name: 'Ambiguity', tax_exempt: false,
    });
    // renewal_date deliberately far in the future: these memberships must never
    // be candidates for the expiry worker / renewal scan, so this spec stays
    // independent of the renewal spec if both run against one database.
    await dataSource.getRepository(Membership).save({
      id: ids.membership, organization_id: ids.organization, member_id: ids.member,
      branch_id: ids.branch, status: 'active',
      start_date: '2026-01-01', end_date: '2027-01-01', renewal_date: '2027-01-01',
      price_at_signup: '100.00', currency_at_signup: 'USD',
    });
    await dataSource.getRepository(Membership).save({
      id: ids.expiredOnlyMembership, organization_id: ids.organization, member_id: ids.member,
      branch_id: ids.branch, status: 'active',
      start_date: '2026-01-01', end_date: '2027-01-01', renewal_date: '2027-01-01',
      price_at_signup: '100.00', currency_at_signup: 'USD',
    });
    await dataSource.getRepository(Membership).save({
      id: ids.futureOpenEndedMembership, organization_id: ids.organization, member_id: ids.member,
      branch_id: ids.branch, status: 'active',
      start_date: '2026-01-01', end_date: '2027-01-01', renewal_date: '2027-01-01',
      price_at_signup: '100.00', currency_at_signup: 'USD',
    });
    // The two memberships that carry the overlapping in-force rows the tie-break
    // test reads. Same non-candidate shape as above: the future `renewal_date`
    // keeps them out of the renewal / expiry scans.
    await dataSource.getRepository(Membership).save({
      id: ids.orderedMembership, organization_id: ids.organization, member_id: ids.member,
      branch_id: ids.branch, status: 'active',
      start_date: '2026-01-01', end_date: '2027-01-01', renewal_date: '2027-01-01',
      price_at_signup: '100.00', currency_at_signup: 'USD',
    });
    await dataSource.getRepository(Membership).save({
      id: ids.tieIdMembership, organization_id: ids.organization, member_id: ids.member,
      branch_id: ids.branch, status: 'active',
      start_date: '2026-01-01', end_date: '2027-01-01', renewal_date: '2027-01-01',
      price_at_signup: '100.00', currency_at_signup: 'USD',
    });

    const discounts = dataSource.getRepository(MembershipDiscount);
    await discounts.save(discounts.create({
      ...expiredRow, membership_id: ids.membership, organization_id: ids.organization,
    }));
    await discounts.save(discounts.create({
      ...activeRow, membership_id: ids.membership, organization_id: ids.organization,
    }));
    await discounts.save(discounts.create({
      ...expiredRow, id: ids.expiredOnlyDiscount,
      membership_id: ids.expiredOnlyMembership, organization_id: ids.organization,
    }));
    await discounts.save(discounts.create({
      ...futureOpenEndedRow,
      membership_id: ids.futureOpenEndedMembership, organization_id: ids.organization,
    }));

    // Overlapping in-force rows for the tie-break: every row is in force
    // (`starts_at <= now`, `ends_at` far future), with at most one open-ended row
    // per membership (the partial unique index constrains only `ends_at IS NULL`).
    const orderedRows = [
      { id: '10000000-0000-4000-8000-000000000003', starts_at: new Date('2025-01-01T00:00:00.000Z'), created_at: new Date('2026-12-01T00:00:00.000Z') },
      { id: '10000000-0000-4000-8000-000000000001', starts_at: new Date('2026-01-01T00:00:00.000Z'), created_at: new Date('2026-01-01T00:00:00.000Z') },
      { id: ORDERED_WINNER,                         starts_at: new Date('2026-01-01T00:00:00.000Z'), created_at: new Date('2026-06-01T00:00:00.000Z') },
    ];
    for (const row of orderedRows) {
      await discounts.save(discounts.create({
        id: row.id, membership_id: ids.orderedMembership, organization_id: ids.organization,
        discount_type: 'fixed', amount: '1.00',
        starts_at: row.starts_at, ends_at: new Date('2099-01-01T00:00:00.000Z'),
      }));
      // `created_at` is a `@CreateDateColumn`, set explicitly after insert so the
      // fixture is deterministic rather than dependent on insert timing.
      await discounts.update({ id: row.id }, { created_at: row.created_at });
    }
    const tieIdRows = [
      { id: '40000000-0000-4000-8000-000000000002', ends_at: new Date('2099-01-01T00:00:00.000Z') },
      { id: TIE_ID_WINNER,                          ends_at: null },
    ];
    for (const row of tieIdRows) {
      await discounts.save(discounts.create({
        id: row.id, membership_id: ids.tieIdMembership, organization_id: ids.organization,
        discount_type: 'fixed', amount: '1.00',
        starts_at: new Date('2026-01-01T00:00:00.000Z'), ends_at: row.ends_at,
      }));
      await discounts.update({ id: row.id }, { created_at: new Date('2026-01-01T00:00:00.000Z') });
    }

    // `addDiscount` touches only the membership/discount repositories, the
    // DataSource and the tenant context. The three collaborators below are never
    // reached on that path, so they are stand-ins rather than fakes with
    // behaviour to assert; the wiring otherwise mirrors
    // `memberships-discount-renewal.integration.spec.ts`, which drives this same
    // constructor with the real services.
    const tenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      requireOrganizationAccess: jest.fn().mockResolvedValue(ids.organization),
      getCurrentUserId: jest.fn().mockResolvedValue(randomUUID()),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    } as unknown as TenantContextService;

    service = new MembershipsService(
      dataSource.getRepository(Membership),
      dataSource.getRepository(MembershipPlan),
      dataSource.getRepository(MembershipHistory),
      dataSource.getRepository(MembershipDiscount),
      dataSource,
      tenantContext,
      {} as OutboxService,
      {} as InvoicesService,
      {} as PaymentsService,
    );
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const org = { organization_id: ids.organization };
    await dataSource.getRepository(MembershipDiscount).delete(org);
    await dataSource.getRepository(Membership).delete(org);
    await dataSource.getRepository(Member).delete(org);
    await dataSource.getRepository(Branch).delete(org);
    await dataSource.getRepository(Organization).delete({ id: ids.organization });
    await dataSource.destroy();
  }, 30000);

  it('rejects a second discount while an active one exists, even with a stale row present', async () => {
    const discounts = dataSource.getRepository(MembershipDiscount);

    // (1) The raw read the PRE-FIX guard issued — membership + org only, no
    // ordering. Kept as evidence: the jest output itself carries which row this
    // query shape returns on this plan. WHICH row it is was the defect, so only
    // "a row came back" is asserted; the fix must not depend on the answer.
    const bare = await discounts.findOne({
      where: { membership_id: ids.membership, organization_id: ids.organization },
    });
    expect(bare).not.toBeNull();
    const which = bare!.id === ids.activeDiscount ? 'ACTIVE'
      : bare!.id === ids.expiredDiscount ? 'EXPIRED (stale)' : 'UNKNOWN';
    console.log(`[evidence] un-ordered read (the pre-fix guard's query shape) -> ${which} (${bare!.id})`);

    // Two rows really are legal and present — the premise of the whole defect.
    const countWhere = { membership_id: ids.membership, organization_id: ids.organization };
    expect(await discounts.count({ where: countWhere })).toBe(2);

    // (2) The predicate the guard now issues — identical to the one `renewOne`
    // bills with. The database selects the row, so the stale one cannot be the
    // one inspected: the result is non-null, therefore the guard fires.
    const now = new Date();
    const guardRow = await discounts.findOne({
      where: {
        membership_id: ids.membership,
        organization_id: ids.organization,
        starts_at: LessThanOrEqual(now),
        ends_at: Or(IsNull(), MoreThan(now)),
      } as any,
      // The SAME ORDER BY the service applies (Q8 D2 fix). The window predicate
      // already excludes the stale row here, so the key itself is pinned by the
      // dedicated overlapping-rows test below.
      order: MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER,
    });
    expect(guardRow).not.toBeNull();
    expect(guardRow!.id).toBe(ids.activeDiscount);

    // (3) ...and the REAL service rejects, against real Postgres. Before the fix
    // this call succeeded and wrote a second in-force row.
    await expect(service.addDiscount(ids.membership, {
      discount_type: 'fixed', amount: 5,
    })).rejects.toThrow(ConflictException);

    // The rejected attempt wrote nothing.
    expect(await discounts.count({ where: countWhere })).toBe(2);
  }, 30000);

  it('maps a future-dated open-ended collision to a 409, not an unhandled driver error', async () => {
    // The only row here starts in 2099, so the belt check's window predicate
    // matches nothing, the guard does NOT fire, and the INSERT is what collides
    // with UQ_membership_discounts_one_active. Before the SQLSTATE mapping that
    // collision escaped as a raw QueryFailedError (500); it must now be the same
    // ConflictException the guard throws — `ConflictException` is exactly what
    // Nest's exception layer renders as HTTP 409.
    const discounts = dataSource.getRepository(MembershipDiscount);
    const countWhere = {
      membership_id: ids.futureOpenEndedMembership, organization_id: ids.organization,
    };
    expect(await discounts.count({ where: countWhere })).toBe(1);

    const attempt = () => service.addDiscount(ids.futureOpenEndedMembership, {
      discount_type: 'fixed', amount: 5,
    });
    await expect(attempt()).rejects.toBeInstanceOf(ConflictException);
    const rejection = (await attempt().catch((error) => error)) as ConflictException;
    expect(rejection.getStatus()).toBe(409);
    expect(rejection.message).toBe('Membership already has an active discount');

    // Both rejected attempts wrote nothing: the transaction rolled back, so the
    // 409 is not merely cosmetic.
    expect(await discounts.count({ where: countWhere })).toBe(1);
  }, 30000);

  it('still accepts a replacement discount once the only row has expired', async () => {
    // The fix must not degrade into "reject whenever any row exists": the
    // create/expire/create cycle is the legitimate path that produced the
    // two-row state asserted above.
    const discounts = dataSource.getRepository(MembershipDiscount);
    expect(await discounts.count({
      where: { membership_id: ids.expiredOnlyMembership, organization_id: ids.organization },
    })).toBe(1);

    const created = await service.addDiscount(ids.expiredOnlyMembership, {
      discount_type: 'fixed', amount: 7,
    });

    expect(created.membership_id).toBe(ids.expiredOnlyMembership);
    expect(created.ends_at).toBeNull();
    const rows = await discounts.find({
      where: { membership_id: ids.expiredOnlyMembership, organization_id: ids.organization },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual([created.id, ids.expiredOnlyDiscount].sort());
  }, 30000);

  it('still rejects a second open-ended discount row (the partial unique index)', async () => {
    // Whatever the guard does, this constraint remains the last line of defence
    // for the `ends_at IS NULL` case — including the residual case in the header,
    // where the row is not in force yet and the window predicate therefore skips
    // it. So the guard's failure mode is an overlapping time-bounded row, or this
    // raw driver error, never two open-ended rows.
    const discounts = dataSource.getRepository(MembershipDiscount);
    await expect(discounts.save(discounts.create({
      membership_id: ids.membership, organization_id: ids.organization,
      discount_type: 'fixed', amount: '5.00',
      starts_at: new Date('2026-03-01T00:00:00.000Z'), ends_at: null,
    }))).rejects.toThrow(/UQ_membership_discounts_one_active|duplicate key value/);
  }, 30000);

  it('orders overlapping in-force rows deterministically (starts_at, created_at, id)', async () => {
    // The tie-break only matters when MORE than one row satisfies the window
    // predicate, which is legal here because the partial unique index constrains
    // only `ends_at IS NULL`. Both reads use the SAME ORDER BY expression the
    // service applies, so a drift in the service key fails this test.
    const discounts = dataSource.getRepository(MembershipDiscount);
    const now = new Date();
    const windowFor = (membershipId: string) => ({
      where: {
        membership_id: membershipId,
        organization_id: ids.organization,
        starts_at: LessThanOrEqual(now),
        ends_at: Or(IsNull(), MoreThan(now)),
      } as any,
      order: MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER,
    });

    // Tie on `starts_at` -> the later `created_at` wins; the earlier-`starts_at`
    // row loses outright.
    const ordered = await discounts.findOne(windowFor(ids.orderedMembership));
    expect(ordered).not.toBeNull();
    expect(ordered!.id).toBe(ORDERED_WINNER);

    // Tie on `starts_at` AND `created_at` -> `id ASC` decides.
    const tied = await discounts.findOne(windowFor(ids.tieIdMembership));
    expect(tied).not.toBeNull();
    expect(tied!.id).toBe(TIE_ID_WINNER);

    // The service rejects on both (an in-force row exists), and WHICH row the
    // key selects is settled above rather than by physical order.
    await expect(service.addDiscount(ids.orderedMembership, {
      discount_type: 'fixed', amount: 5,
    })).rejects.toThrow(ConflictException);
  }, 30000);
});
