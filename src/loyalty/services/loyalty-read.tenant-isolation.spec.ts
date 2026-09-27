import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { MembersService } from '../../members/services/members.service';
import { Member } from '../../members/entities/member.entity';
import { MemberProfile } from '../../members/entities/member-profile.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyReadService } from './loyalty-read.service';

/**
 * DB-backed proof that P6-28's read path is tenant-isolated.
 *
 * **Why a real database.** Tenant isolation here is a property of the SQL: every
 * query filters `organization_id`, and `LOYALTY_TRANSACTIONS.organization_id`
 * (P6-25 resolution D, populated by both writers) is what makes the ledger
 * filterable. A mocked repository proves that a `where` clause was *passed*; only
 * a real database proves the other tenant's rows are not *returned*.
 *
 * This spec seeds two organizations, each with its own member, branch, account and
 * ledger, then reads one org's data while the other org's rows exist in the same
 * tables — including the two cases a naive implementation gets wrong:
 *   - a member id from the other organization is REJECTED (404), not answered with
 *     a zeroed balance that quietly implies the member has no points;
 *   - the dashboard's aggregates EXCLUDE the other organization's rows.
 *
 * **When it runs.** Same gate as the writers' spec: whenever `DB_HOST` is set. CI
 * provisions a `postgres:16-alpine` service and sets it job-wide, so this suite
 * executes there; with no `DB_*` variables it skips rather than erroring, keeping a
 * local `npm test` without Postgres passing.
 */
const ENABLED = Boolean(process.env.DB_HOST);
const describeDb = ENABLED ? describe : describe.skip;

describeDb('LoyaltyReadService is tenant-isolated (P6-28)', () => {
  let ds: DataSource;
  let readService: LoyaltyReadService;
  let tenantContext: TenantContextService;

  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  const memberA = crypto.randomUUID();
  const memberB = crypto.randomUUID();
  const memberNoActivity = crypto.randomUUID();

  let accountA: LoyaltyAccount;
  let accountB: LoyaltyAccount;

  /** Run `fn` as if the request were authorized for `orgId`. */
  const asOrg = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
    tenantContext.runWithContext({}, async () => {
      await tenantContext.setCurrentOrganizationId(orgId);
      return fn();
    });

  beforeAll(async () => {
    ds = AppDataSource;
    await ds.initialize();
    await ds.runMigrations();

    // The real TenantContextService (its store is AsyncLocalStorage-backed, so the
    // context set below is the one the service reads) and the real MembersService,
    // so the cross-tenant rejection runs through the same org-scoped lookup
    // production uses rather than a stand-in that agrees with the test.
    // `identityService`, `localIdService` and `outboxService` are unused by the two
    // paths under test (`getCurrentOrganizationId`, `findOne`).
    tenantContext = new TenantContextService({} as never, ds.getRepository(Branch));
    const membersService = new MembersService(
      ds.getRepository(Member),
      ds.getRepository(MemberProfile),
      ds,
      {} as never,
      tenantContext,
      {} as never,
    );
    readService = new LoyaltyReadService(
      ds.getRepository(LoyaltyAccount),
      ds.getRepository(LoyaltyTransaction),
      membersService,
      tenantContext,
    );

    const orgRepo = ds.getRepository(Organization);
    await orgRepo.save([
      { id: orgA, name: 'read-test-org-a', timezone: 'UTC', locale: 'en-US', currency: 'USD' },
      { id: orgB, name: 'read-test-org-b', timezone: 'UTC', locale: 'en-US', currency: 'USD' },
    ]);

    await ds.getRepository(Branch).save([
      { id: branchA, organization_id: orgA, name: 'A', address: 'a', phone: '1' },
      { id: branchB, organization_id: orgB, name: 'B', address: 'b', phone: '2' },
    ]);

    await ds.getRepository(Member).save([
      {
        id: memberA,
        organization_id: orgA,
        branch_id: branchA,
        global_uuid: crypto.randomUUID(),
        local_id: 1,
        first_name: 'A',
        last_name: 'Member',
      },
      {
        id: memberB,
        organization_id: orgB,
        branch_id: branchB,
        global_uuid: crypto.randomUUID(),
        local_id: 2,
        first_name: 'B',
        last_name: 'Member',
      },
      {
        id: memberNoActivity,
        organization_id: orgA,
        branch_id: branchA,
        global_uuid: crypto.randomUUID(),
        local_id: 3,
        first_name: 'No',
        last_name: 'Activity',
      },
    ]);

    const accountRepo = ds.getRepository(LoyaltyAccount);
    // The counter and the ledger are made to agree here, because the ticket's
    // criterion is that the read path's balance matches the ledger: earn 50 + earn 7
    // − redeem 15 = 42.
    accountA = await accountRepo.save({
      organization_id: orgA,
      member_id: memberA,
      balance: 42,
      lifetime_points_earned: 57,
      lifetime_points_redeemed: 15,
    });
    accountB = await accountRepo.save({
      organization_id: orgB,
      member_id: memberB,
      balance: 999,
      lifetime_points_earned: 999,
      lifetime_points_redeemed: 0,
    });

    const txnRepo = ds.getRepository(LoyaltyTransaction);
    await txnRepo.save([
      {
        account_id: accountA.id,
        organization_id: orgA,
        transaction_type: 'earn',
        points: 50,
        remaining_points: 35,
        reference_type: 'check_in',
        description: 'org A earn',
      },
      {
        account_id: accountA.id,
        organization_id: orgA,
        transaction_type: 'redeem',
        points: 15,
        remaining_points: 0,
        reference_type: 'reward',
        description: 'org A redeem',
      },
      {
        account_id: accountB.id,
        organization_id: orgB,
        transaction_type: 'earn',
        points: 999,
        remaining_points: 999,
        reference_type: 'check_in',
        description: 'org B earn — must never appear in an org A read',
      },
    ]);

    // An org A row deliberately outside the default 30-day window, so window
    // filtering is exercised as well as organization filtering.
    const old = await txnRepo.save({
      account_id: accountA.id,
      organization_id: orgA,
      transaction_type: 'earn',
      points: 7,
      remaining_points: 7,
      reference_type: 'check_in',
      description: 'org A earn, 100 days ago',
    });
    await ds.query(
      `UPDATE "LOYALTY_TRANSACTIONS" SET created_at = now() - interval '100 days' WHERE id = $1`,
      [old.id],
    );
  }, 120_000);

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    const orgs = [orgA, orgB];
    await ds.query(`DELETE FROM "LOYALTY_TRANSACTIONS" WHERE organization_id = ANY($1)`, [orgs]);
    await ds.query(`DELETE FROM "LOYALTY_ACCOUNTS" WHERE organization_id = ANY($1)`, [orgs]);
    await ds
      .getRepository(Member)
      .delete([{ id: memberA }, { id: memberB }, { id: memberNoActivity }]);
    await ds.getRepository(Branch).delete([{ id: branchA }, { id: branchB }]);
    await ds.getRepository(Organization).delete([{ id: orgA }, { id: orgB }]);
    await ds.destroy();
  });

  describe('balance', () => {
    it('matches the account row, which the ledger for that account adds up to', async () => {
      const balance = await asOrg(orgA, () => readService.getBalance(memberA));

      expect(balance.accountId).toBe(accountA.id);
      expect(balance.balance).toBe(42);
      expect(balance.lifetimePointsEarned).toBe(57);
      expect(balance.lifetimePointsRedeemed).toBe(15);

      // The ledger really does support the counter, so a wrong balance could not
      // hide behind a matching fixture.
      const [sums] = await ds.query(
        `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'earn' THEN points ELSE 0 END), 0)::int AS earned,
                COALESCE(SUM(CASE WHEN transaction_type = 'redeem' THEN points ELSE 0 END), 0)::int AS redeemed
           FROM "LOYALTY_TRANSACTIONS" WHERE account_id = $1`,
        [accountA.id],
      );
      expect(sums.earned - sums.redeemed).toBe(balance.balance);
    });

    it('REJECTS a member that belongs to another organization (404, not a zeroed answer)', async () => {
      await expect(asOrg(orgA, () => readService.getBalance(memberB))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a zeroed balance for a same-org member with no account yet', async () => {
      const balance = await asOrg(orgA, () => readService.getBalance(memberNoActivity));
      expect(balance.accountId).toBeNull();
      expect(balance.balance).toBe(0);
    });

    it('refuses to read at all when no organization is in context', async () => {
      await expect(readService.getBalance(memberA)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('transactions', () => {
    it('returns only the account’s rows, and only under its own organization', async () => {
      const page = await asOrg(orgA, () => readService.getTransactions(memberA, { page: 1, limit: 20 }));

      // The org A ledger is earn 50 + redeem 15 in-window, plus the 100-day-old earn.
      expect(page.total).toBe(3);
      expect(page.data).toHaveLength(3);
      expect(page.data.every((row) => row.description?.startsWith('org A'))).toBe(true);
      expect(page.data.some((row) => row.points === 999)).toBe(false);
    });

    it('EXCLUDES the other organization’s ledger rows', async () => {
      // The org B row exists and is not windowed away — it is the only row that
      // account has — so an unfiltered query would return exactly it.
      const [orgBRows] = await ds.query(
        `SELECT COUNT(*)::int AS count FROM "LOYALTY_TRANSACTIONS" WHERE account_id = $1`,
        [accountB.id],
      );
      expect(orgBRows.count).toBeGreaterThan(0);

      const orgAPage = await asOrg(orgA, () =>
        readService.getTransactions(memberA, { page: 1, limit: 100 }),
      );
      const ids = orgAPage.data.map((row) => row.id);
      const [orgBIds] = await ds.query(
        `SELECT COALESCE(array_agg(id::text), '{}') AS ids FROM "LOYALTY_TRANSACTIONS" WHERE account_id = $1`,
        [accountB.id],
      );
      for (const id of orgBIds.ids) {
        expect(ids).not.toContain(id);
      }
    });

    it('REJECTS a member that belongs to another organization', async () => {
      await expect(
        asOrg(orgA, () => readService.getTransactions(memberB, { page: 1, limit: 20 })),
      ).rejects.toThrow(NotFoundException);
    });

    it('paginates and reports the unmatched total', async () => {
      const first = await asOrg(orgA, () => readService.getTransactions(memberA, { page: 1, limit: 2 }));
      expect(first.total).toBe(3);
      expect(first.data).toHaveLength(2);
      expect(first.page).toBe(1);
      expect(first.limit).toBe(2);
    });
  });

  describe('dashboard', () => {
    it('EXCLUDES the other organization from every §6.7 figure', async () => {
      const dash = await asOrg(orgA, () => readService.getDashboard({}));

      // §6.7 "Points Issued/Burned" — org A's in-window earn is 50; org B's 999
      // must not appear anywhere in the breakdown.
      const earn = dash.pointsIssuedBurned.find((row) => row.transactionType === 'earn');
      expect(earn?.totalPoints).toBe(50);
      expect(dash.pointsIssuedBurned.some((row) => row.totalPoints === 999)).toBe(false);
      expect(dash.pointsIssuedBurned.every((row) => row.count >= 0)).toBe(true);

      // §6.7 "Redemption Rate" — 15 of 50.
      expect(dash.redemptionRate.issued).toBe(50);
      expect(dash.redemptionRate.redeemed).toBe(15);
      expect(dash.redemptionRate.rate).toBeCloseTo(0.3, 10);

      // §6.7 "Active Loyalty Accounts" (P6-25 resolution D): org A has one account
      // with in-window transactions; org B's account must not be counted.
      expect(dash.activeAccounts).toBe(1);
    });

    it('applies the window: a 100-day-old row is outside the default 30 days', async () => {
      const dash = await asOrg(orgA, () => readService.getDashboard({}));
      const earn = dash.pointsIssuedBurned.find((row) => row.transactionType === 'earn');
      // 50, not 57 — the 100-day-old earn is excluded by the window.
      expect(earn?.totalPoints).toBe(50);

      const wide = await asOrg(orgA, () =>
        readService.getDashboard({
          from: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      );
      const wideEarn = wide.pointsIssuedBurned.find((row) => row.transactionType === 'earn');
      expect(wideEarn?.totalPoints).toBe(57);
    });

    it('rejects an inverted window instead of returning a plausible zero', async () => {
      const now = new Date().toISOString();
      const earlier = new Date(Date.now() - 86_400_000).toISOString();
      await expect(
        asOrg(orgA, () => readService.getDashboard({ from: now, to: earlier })),
      ).rejects.toThrow();
    });

    it('refuses to aggregate when no organization is in context', async () => {
      await expect(readService.getDashboard({})).rejects.toThrow(ForbiddenException);
    });
  });
});
