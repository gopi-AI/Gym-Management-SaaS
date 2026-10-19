/**
 * Real-Postgres regression for P1-03's extend and transfer actions.
 *
 * WHY THIS EXISTS ALONGSIDE THE MOCKED SPEC
 * The mocked suite pins the branches, but it cannot show that two concurrent
 * transactions compose (or replay) the way the idempotency key and row lock
 * claim: a mock has one in-memory membership and no transaction isolation. This
 * spec drives the real service against a migrated schema and asserts through a
 * SECOND read — history-row counts, the outbox table, and the membership row —
 * so a lost update or a double-apply is visible.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/memberships/services/memberships-extend-transfer
 * The database MUST already be migrated. Export only the DB_ and REDIS_
 * variables; never JWT_SECRET (see the DEF-15 integration spec).
 *
 * The suite writes rows under one freshly generated organization and deletes
 * them in `afterAll`. Point it at a THROWAWAY database.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { Membership } from '../entities/membership.entity';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { MembershipHistory } from '../entities/membership-history.entity';
import { MembershipDiscount } from '../entities/membership-discount.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Member } from '../../members/entities/member.entity';
import { IdentityUser } from '../../identity/entities/identity-users.entity';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { InvoicesService } from '../../finance/services/invoices.service';
import { PaymentsService } from '../../finance/services/payments.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

const TODAY = new Date().toISOString().slice(0, 10);

/** `dateOnly` plus `days` calendar days, in `YYYY-MM-DD` form. */
function plusDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describeIntegration('Membership extend + transfer (real Postgres)', () => {
  let dataSource: DataSource;
  let service: MembershipsService;
  const actorUserId = randomUUID();

  const ids = {
    organization: randomUUID(),
    otherOrganization: randomUUID(),
    branch: randomUUID(),
    targetBranch: randomUUID(),
    inactiveBranch: randomUUID(),
    otherOrgBranch: randomUUID(),
    member: randomUUID(),
    plan: randomUUID(),
    sameKeyMembership: randomUUID(),
    differentKeyMembership: randomUUID(),
    transferMembership: randomUUID(),
    guardMembership: randomUUID(),
    cancelledMembership: randomUUID(),
    openEndedMembership: randomUUID(),
    noBranchMembership: randomUUID(),
  };

  // `Record<string, unknown>` rather than `Partial<Membership>`: the entity
  // types date columns as `string | undefined`, but the schema (and these
  // fixtures) legitimately use NULL for an open-ended membership.
  const membershipDefaults = (
    id: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id,
    organization_id: ids.organization,
    member_id: ids.member,
    plan_id: ids.plan,
    branch_id: ids.branch,
    status: 'active',
    start_date: TODAY,
    end_date: plusDays(TODAY, 30),
    renewal_date: plusDays(TODAY, 30),
    price_at_signup: '100.00',
    currency_at_signup: 'USD',
    ...overrides,
  });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      // Same resolution rule as src/data-source.ts.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    // `MembershipHistory.changed_by` is FK-constrained to IDENTITY_USERS, so the
    // actor returned by the tenant-context double must be a real row.
    await dataSource.getRepository(IdentityUser).save({
      id: actorUserId,
      email: `extend-transfer-${actorUserId}@example.com`,
      password_hash: 'integration-test-not-a-real-hash',
      first_name: 'Extend',
      last_name: 'Actor',
    });
    await dataSource.getRepository(Organization).save({
      id: ids.organization, name: 'Extend Transfer E2E Org',
      timezone: 'UTC', locale: 'en-US', currency: 'USD',
    });
    await dataSource.getRepository(Organization).save({
      id: ids.otherOrganization, name: 'Extend Transfer Other Org',
      timezone: 'UTC', locale: 'en-US', currency: 'USD',
    });

    const branches = dataSource.getRepository(Branch);
    await branches.save([
      { id: ids.branch, organization_id: ids.organization, name: 'Main', address: '1 Test Street', phone: '+10000000001', is_active: true },
      { id: ids.targetBranch, organization_id: ids.organization, name: 'Second', address: '2 Test Street', phone: '+10000000002', is_active: true },
      { id: ids.inactiveBranch, organization_id: ids.organization, name: 'Closed', address: '3 Test Street', phone: '+10000000003', is_active: false },
      { id: ids.otherOrgBranch, organization_id: ids.otherOrganization, name: 'Foreign', address: '4 Test Street', phone: '+10000000004', is_active: true },
    ] as Branch[]);

    await dataSource.getRepository(Member).save({
      id: ids.member, organization_id: ids.organization, branch_id: ids.branch,
      global_uuid: randomUUID(), local_id: 1,
      first_name: 'Extend', last_name: 'Transfer', tax_exempt: false,
    });
    await dataSource.getRepository(MembershipPlan).save({
      id: ids.plan, organization_id: ids.organization, name: 'Monthly Standard',
      price: '100.00', currency: 'USD', billing_period: 'monthly', duration_days: 30,
    });

    const memberships = dataSource.getRepository(Membership);
    await memberships.save([
      membershipDefaults(ids.sameKeyMembership),
      membershipDefaults(ids.differentKeyMembership),
      membershipDefaults(ids.transferMembership),
      membershipDefaults(ids.guardMembership),
      membershipDefaults(ids.cancelledMembership, { status: 'cancelled' }),
      membershipDefaults(ids.openEndedMembership, { end_date: null, renewal_date: null }),
      membershipDefaults(ids.noBranchMembership, { branch_id: null }),
    ] as unknown as Membership[]);

    const tenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      requireOrganizationAccess: jest.fn().mockResolvedValue(ids.organization),
      getCurrentUserId: jest.fn().mockResolvedValue(actorUserId),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    } as unknown as TenantContextService;

    service = new MembershipsService(
      dataSource.getRepository(Membership),
      dataSource.getRepository(MembershipPlan),
      dataSource.getRepository(MembershipHistory),
      dataSource.getRepository(MembershipDiscount),
      dataSource,
      tenantContext,
      new OutboxService(dataSource.getRepository(OutboxEntity)),
      {} as unknown as InvoicesService,
      {} as unknown as PaymentsService,
    );
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const org = { organization_id: ids.organization };
    // Children first. The outbox has no organization column, so its rows are
    // identified by the correlation id (the membership id).
    await dataSource.query(
      `DELETE FROM shared.outbox WHERE "correlationId" = ANY($1)`,
      [[
        ids.sameKeyMembership, ids.differentKeyMembership, ids.transferMembership,
        ids.guardMembership, ids.cancelledMembership, ids.openEndedMembership,
        ids.noBranchMembership,
      ]],
    );
    await dataSource.getRepository(MembershipHistory).delete(org);
    await dataSource.getRepository(IdentityUser).delete({ id: actorUserId });
    await dataSource.getRepository(Membership).delete(org);
    await dataSource.getRepository(MembershipPlan).delete({ id: ids.plan });
    await dataSource.getRepository(Member).delete({ id: ids.member });
    await dataSource.getRepository(Branch).delete({ organization_id: ids.organization });
    await dataSource.getRepository(Branch).delete({ organization_id: ids.otherOrganization });
    await dataSource.getRepository(Organization).delete({ id: ids.organization });
    await dataSource.getRepository(Organization).delete({ id: ids.otherOrganization });
    await dataSource.destroy();
  });

  const readMembership = async (id: string): Promise<Membership> => {
    const row = await dataSource.getRepository(Membership).findOne({ where: { id } });
    if (!row) throw new Error(`membership ${id} disappeared`);
    return row;
  };

  const countHistory = (membershipId: string, transition: string): Promise<number> =>
    dataSource.getRepository(MembershipHistory).count({
      where: { membership_id: membershipId, transition } as never,
    });

  const countOutbox = async (eventType: string, membershipId: string): Promise<number> => {
    const rows = await dataSource.query(
      `SELECT count(*)::int AS n FROM shared.outbox
       WHERE "eventType" = $1 AND "correlationId" = $2`,
      [eventType, membershipId],
    );
    return rows[0].n;
  };

  describe('extend', () => {
    it('two concurrent calls with the SAME key apply once; the loser replays', async () => {
      const dto = {
        days: 30,
        reason: 'Concurrent same key',
        idempotency_key: `same-${randomUUID()}`,
      };

      const [a, b] = await Promise.all([
        service.extend(ids.sameKeyMembership, dto),
        service.extend(ids.sameKeyMembership, dto),
      ]);

      expect([a.created, b.created].sort()).toEqual([false, true]);
      const fresh = await readMembership(ids.sameKeyMembership);
      expect(fresh.end_date).toBe(plusDays(TODAY, 60));
      expect(await countHistory(ids.sameKeyMembership, 'extend')).toBe(1);
      expect(await countOutbox('MembershipExtended', ids.sameKeyMembership)).toBe(1);
    });

    it('a later retry of the same key replays without another write', async () => {
      const key = `retry-${randomUUID()}`;
      const first = await service.extend(ids.guardMembership, {
        days: 5, reason: 'First', idempotency_key: key,
      });
      expect(first.created).toBe(true);
      const afterFirst = await readMembership(ids.guardMembership);

      const second = await service.extend(ids.guardMembership, {
        days: 5, reason: 'First', idempotency_key: key,
      });

      expect(second.created).toBe(false);
      expect(second.membership.end_date).toBe(afterFirst.end_date);
      expect(await countHistory(ids.guardMembership, 'extend')).toBe(1);
      expect(await countOutbox('MembershipExtended', ids.guardMembership)).toBe(1);
    });

    it('two concurrent calls with DIFFERENT keys both apply', async () => {
      const [a, b] = await Promise.all([
        service.extend(ids.differentKeyMembership, {
          days: 10, reason: 'First', idempotency_key: `a-${randomUUID()}`,
        }),
        service.extend(ids.differentKeyMembership, {
          days: 20, reason: 'Second', idempotency_key: `b-${randomUUID()}`,
        }),
      ]);

      expect([a.created, b.created]).toEqual([true, true]);
      const fresh = await readMembership(ids.differentKeyMembership);
      // 30 (fixture) + 10 + 20 — neither update is lost.
      expect(fresh.end_date).toBe(plusDays(TODAY, 60));
      expect(await countHistory(ids.differentKeyMembership, 'extend')).toBe(2);
      expect(await countOutbox('MembershipExtended', ids.differentKeyMembership)).toBe(2);
    });

    it('rejects a cancelled membership, an open-ended membership, and an end-before-start result', async () => {
      await expect(service.extend(ids.cancelledMembership, {
        days: 10, reason: 'No', idempotency_key: `c-${randomUUID()}`,
      })).rejects.toThrow(BadRequestException);

      await expect(service.extend(ids.openEndedMembership, {
        days: 10, reason: 'No', idempotency_key: `o-${randomUUID()}`,
      })).rejects.toThrow(BadRequestException);

      await expect(service.extend(ids.guardMembership, {
        days: -365, reason: 'No', idempotency_key: `e-${randomUUID()}`,
      })).rejects.toThrow(ConflictException);

      expect(await countHistory(ids.cancelledMembership, 'extend')).toBe(0);
      expect(await countHistory(ids.openEndedMembership, 'extend')).toBe(0);
      expect((await readMembership(ids.cancelledMembership)).status).toBe('cancelled');
      expect((await readMembership(ids.openEndedMembership)).end_date).toBeNull();
    });
  });

  describe('transfer', () => {
    it('two concurrent calls to the same branch write exactly one history row and one event', async () => {
      const [a, b] = await Promise.all([
        service.transfer(ids.transferMembership, { to_branch_id: ids.targetBranch }),
        service.transfer(ids.transferMembership, { to_branch_id: ids.targetBranch }),
      ]);

      expect(a.branch_id).toBe(ids.targetBranch);
      expect(b.branch_id).toBe(ids.targetBranch);
      const fresh = await readMembership(ids.transferMembership);
      expect(fresh.branch_id).toBe(ids.targetBranch);
      expect(await countHistory(ids.transferMembership, 'transfer')).toBe(1);
      expect(await countOutbox('MembershipTransferred', ids.transferMembership)).toBe(1);
    });

    it('leaves the membership untouched for an unknown, cross-org, or inactive target', async () => {
      const before = await readMembership(ids.guardMembership);

      await expect(service.transfer(ids.guardMembership, {
        to_branch_id: randomUUID(),
      })).rejects.toThrow(NotFoundException);

      await expect(service.transfer(ids.guardMembership, {
        to_branch_id: ids.otherOrgBranch,
      })).rejects.toThrow(NotFoundException);

      await expect(service.transfer(ids.guardMembership, {
        to_branch_id: ids.inactiveBranch,
      })).rejects.toThrow(ConflictException);

      const after = await readMembership(ids.guardMembership);
      expect(after.branch_id).toBe(before.branch_id);
      expect(await countHistory(ids.guardMembership, 'transfer')).toBe(0);
      expect(await countOutbox('MembershipTransferred', ids.guardMembership)).toBe(0);
    });

    it('rejects a cancelled membership and a membership with no current branch', async () => {
      await expect(service.transfer(ids.cancelledMembership, {
        to_branch_id: ids.targetBranch,
      })).rejects.toThrow(BadRequestException);

      await expect(service.transfer(ids.noBranchMembership, {
        to_branch_id: ids.targetBranch,
      })).rejects.toThrow(BadRequestException);

      expect((await readMembership(ids.cancelledMembership)).branch_id).toBe(ids.branch);
      expect((await readMembership(ids.noBranchMembership)).branch_id).toBeNull();
      expect(await countHistory(ids.cancelledMembership, 'transfer')).toBe(0);
      expect(await countHistory(ids.noBranchMembership, 'transfer')).toBe(0);
    });
  });
});
