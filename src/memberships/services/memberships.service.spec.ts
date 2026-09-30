import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { MembershipsService, NON_TERMINAL_STATUSES, MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER } from './memberships.service';
import { Membership } from '../entities/membership.entity';
import { MembershipHistory } from '../entities/membership-history.entity';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { MembershipDiscount } from '../entities/membership-discount.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { InvoicesService } from '../../finance/services/invoices.service';
import { Invoice } from '../../finance/entities/invoice.entity';
import { InvoiceItem } from '../../finance/entities/invoice-item.entity';
import { InvoiceDiscount } from '../../finance/entities/invoice-discount.entity';
import { TaxLine } from '../../finance/entities/tax-line.entity';
import { Payment } from '../../finance/entities/payment.entity';
import { PaymentsService } from '../../finance/services/payments.service';
import * as fs from 'fs';
import * as path from 'path';
import { EVENT_TYPES, EVENT_VERSIONS } from '../../../packages/contracts/src/events/membership.events';
import type {
  MembershipResumedPayload,
  MembershipFreezeStartedPayload,
  MembershipFreezeEndedPayload,
  MembershipTransferredPayload,
} from '../../../packages/contracts/src/events/membership.events';

/**
 * Fixture end date for the lifecycle-event tests, as a `YYYY-MM-DD` string — the
 * format `Membership.end_date` uses, and the format the service appends
 * `'T00:00:00Z'` to when it derives `remainingDays` / `daysRemaining`.
 *
 * Deliberately RELATIVE, not a literal. This fixture used to be a hard-coded
 * `'2026-10-01'`, which made the two `toBeGreaterThan(0)` assertions on those
 * payload fields date-bomb: they can only pass while more than one whole day
 * remains before the fixture date, so they started failing daily from
 * 2026-09-30 onward. A 30-day margin computed at load time keeps the derived
 * day count at 29 or 30 on every run date in every year — there is no calendar
 * date at which this margin shrinks, because the offset is recomputed from the
 * clock rather than measured against a fixed point.
 */
const FUTURE_END_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/**
 * `dateOnly` plus `days` whole calendar days, in the same `YYYY-MM-DD` form.
 * Mirrors `addDaysToDate` in `memberships.service.ts` so the expectation is
 * derived exactly the way the service derives the value it is compared with.
 */
function plusCalendarDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('MembershipsService', () => {
  let service: MembershipsService;
  let mockMembershipRepo: Record<string, jest.Mock>;
  let mockPlanRepo: Record<string, jest.Mock>;
  let mockHistoryRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, any>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;
  let mockInvoicesService: Record<string, jest.Mock>;
  let mockDiscountRepo: Record<string, jest.Mock>;
  let mockPaymentRepo: Record<string, jest.Mock>;
  let mockInvoiceRepo: Record<string, jest.Mock>;
  let mockInvoiceRenewalQuery: Record<string, jest.Mock>;
  let mockPaymentsService: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const userId = 'user-456';

  // Query-builder stub for the due-candidate scan in `expireDueMemberships`:
  // each test decides which memberships the scan returns from `getMany`.
  let membershipQueryBuilder: Record<string, jest.Mock>;

  beforeEach(async () => {
    membershipQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    mockMembershipRepo = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(() => membershipQueryBuilder),
    };

    mockPaymentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => ({ id: 'renewal-payment', ...value })),
    };
    mockInvoiceRenewalQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    mockInvoiceRepo = {
      createQueryBuilder: jest.fn(() => mockInvoiceRenewalQuery),
      findOne: jest.fn().mockResolvedValue(null),
    };

    mockPlanRepo = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockDiscountRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue({}),
    };

    mockHistoryRepo = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: Function) => {
        const manager = {
          getRepository: jest.fn().mockImplementation((repo: any) => {
            if (repo === Membership) return mockMembershipRepo;
            if (repo === MembershipHistory) return mockHistoryRepo;
            if (repo === MembershipPlan) return mockPlanRepo;
            if (repo === MembershipDiscount) return mockDiscountRepo;
            if (repo === Invoice) return mockInvoiceRepo;
            if (repo === InvoiceItem) return {};
            if (repo === Payment) return mockPaymentRepo;
            return {};
          }),
        };
        return cb(manager);
      }),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ '1': 1 }),
      })),
      getRepository: jest.fn().mockImplementation((repo: any) => {
        if (repo === Payment) return mockPaymentRepo;
        return {};
      }),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn(),
      getCurrentUserId: jest.fn().mockResolvedValue(userId),
      validateBranchAccess: jest.fn(),
    };

    mockOutboxService = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
      saveEventEnvelope: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };

    mockInvoicesService = {
      createForMembershipSale: jest.fn().mockResolvedValue({ invoice: {}, items: [] }),
    };
    mockPaymentsService = {
      attemptWithSavedMethod: jest.fn().mockResolvedValue({ status: 'pending', retryCount: 1, exhausted: false }),
    };
    mockPaymentRepo.findOne.mockResolvedValue({
      id: 'renewal-payment',
      organization_id: orgId,
      member_id: 'member-due',
      invoice_id: 'renewal-invoice',
      amount: '99.99',
      status: 'pending',
      retry_count: 1,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: getRepositoryToken(Membership), useValue: mockMembershipRepo },
        { provide: getRepositoryToken(MembershipPlan), useValue: mockPlanRepo },
        { provide: getRepositoryToken(MembershipHistory), useValue: mockHistoryRepo },
        { provide: getRepositoryToken(MembershipDiscount), useValue: mockDiscountRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: InvoicesService, useValue: mockInvoicesService },
        { provide: PaymentsService, useValue: mockPaymentsService },
      ],
    }).compile();

    service = module.get<MembershipsService>(MembershipsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('renew (P3-09)', () => {
    const dueMembership = {
      id: 'renewal-membership',
      organization_id: orgId,
      member_id: 'renewal-member',
      plan_id: 'renewal-plan',
      branch_id: null,
      status: 'active',
      start_date: '2025-01-01',
      end_date: '2025-02-01',
      renewal_date: '2025-02-01',
      price_at_signup: '99.99',
      currency_at_signup: 'USD',
      created_at: new Date('2025-01-01T00:00:00Z'),
      updated_at: new Date('2025-01-01T00:00:00Z'),
    } as unknown as Membership;

    const prepareRenewal = (
      paymentStatus: string,
      // The row the post-charge lock re-reads. Defaults to the same due cycle;
      // tests covering the "already settled by a concurrent run" case override it.
      postChargeMembership: unknown = { ...dueMembership },
    ) => {
      const successfulPayment = {
        id: 'renewal-payment', organization_id: orgId, member_id: dueMembership.member_id,
        invoice_id: 'renewal-invoice', amount: '99.99', status: 'pending', retry_count: 0,
      } as Payment;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(dueMembership) // authorized tenant read
        .mockResolvedValueOnce(dueMembership) // locked during invoice/payment creation
        .mockResolvedValueOnce(postChargeMembership); // post-success lock when charged
      mockPlanRepo.findOne.mockResolvedValue({ id: dueMembership.plan_id, duration_days: 30 });
      mockInvoiceRenewalQuery.getOne.mockResolvedValue(null);
      mockInvoicesService.createForMembershipSale.mockResolvedValue({
        invoice: { id: 'renewal-invoice', total_amount: '99.99', status: 'sent' },
      });
      mockPaymentRepo.findOne
        .mockResolvedValueOnce(null) // no existing payment for this cycle
        .mockResolvedValueOnce(null) // same-cycle payment lookup
        .mockResolvedValueOnce({ ...successfulPayment, status: paymentStatus, retry_count: 1 }); // reload after gateway path
      mockPaymentsService.attemptWithSavedMethod.mockResolvedValue({
        status: paymentStatus, retryCount: 1, exhausted: paymentStatus === 'failed',
      });
      return successfulPayment;
    };

    it('scopes the target membership to the authorized organization and extends only after a succeeded payment', async () => {
      prepareRenewal('succeeded');
      const result = await service.renew(dueMembership.id);

      expect(mockMembershipRepo.findOne).toHaveBeenNthCalledWith(1, {
        where: { id: dueMembership.id, organization_id: orgId },
      });
      expect(mockMembershipRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { id: dueMembership.id, organization_id: orgId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockInvoicesService.createForMembershipSale).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: orgId,
        memberId: dueMembership.member_id,
        membershipId: dueMembership.id,
        amount: dueMembership.price_at_signup,
        manager: expect.any(Object),
      }));
      expect(mockPaymentsService.attemptWithSavedMethod).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'renewal-payment', status: 'pending' }),
        expect.any(Date),
        1,
      );
      expect(mockMembershipRepo.update).toHaveBeenCalledWith(
        { id: dueMembership.id, organization_id: orgId },
        { end_date: '2025-03-03', renewal_date: '2025-03-03' },
      );
      expect(result.payment).toMatchObject({ id: 'renewal-payment', status: 'succeeded', retry_count: 1 });
    });

    // Regression for the P3-04b defect this file's `create()`-side discount test
    // could NOT catch: renewal is the only path where an active discount can be
    // in force when an invoice is raised, and `renewOne` simply never looked one
    // up, so a discount row existed while every renewal invoice was full price.
    // The assertion below is a full-object `toHaveBeenCalledWith` rather than
    // `objectContaining` precisely so that a MISSING `discount` key fails — the
    // pre-fix call is otherwise byte-identical.
    it('passes an active membership discount into the renewal invoice (P3-04b regression)', async () => {
      prepareRenewal('succeeded');
      // Plan name is only used to build the line description; make it explicit so
      // the expected payload below can be asserted exactly.
      mockPlanRepo.findOne.mockResolvedValue({
        id: dueMembership.plan_id, duration_days: 30, name: 'Monthly',
      });
      mockDiscountRepo.findOne.mockResolvedValue({
        id: 'discount-renewal',
        membership_id: dueMembership.id,
        organization_id: orgId,
        discount_type: 'percentage',
        amount: '20.00',
        starts_at: new Date('2025-01-01T00:00:00.000Z'),
        ends_at: null,
      } as MembershipDiscount);

      await service.renew(dueMembership.id);

      // Two layers asserted separately: the lookup stays keyed to THIS membership
      // and THIS organization (tenant boundary), and the value it found reaches
      // the invoice hook.
      const lookup = mockDiscountRepo.findOne.mock.calls[0][0] as {
        where: Record<string, unknown>;
        order?: unknown;
      };
      expect(lookup.where.membership_id).toBe(dueMembership.id);
      expect(lookup.where.organization_id).toBe(orgId);
      // The tie-break is asserted, not just the call: without an `order` this
      // read is heap-order dependent (plan §15 Q8 D2 fix).
      expect(lookup.order).toEqual(MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER);

      expect(mockInvoicesService.createForMembershipSale).toHaveBeenCalledWith({
        organizationId: orgId,
        memberId: dueMembership.member_id,
        membershipId: dueMembership.id,
        branchId: dueMembership.branch_id,
        description: 'Membership renewal: Monthly',
        amount: dueMembership.price_at_signup,
        discount: { id: 'discount-renewal', discount_type: 'percentage', amount: '20.00' },
        dueDate: expect.any(Date),
        manager: expect.any(Object),
      });
    });

    it('still renews at full price when the membership has no discount', async () => {
      prepareRenewal('succeeded');
      // mockDiscountRepo.findOne defaults to null (no row).
      await service.renew(dueMembership.id);

      expect(mockDiscountRepo.findOne).toHaveBeenCalled();
      const input = mockInvoicesService.createForMembershipSale.mock.calls[0][0];
      expect(input).toHaveProperty('discount', undefined);
    });

    it('does not extend or expire a membership when the renewal charge fails', async () => {
      prepareRenewal('failed');
      const result = await service.renew(dueMembership.id);

      expect(result.payment.status).toBe('failed');
      expect(mockMembershipRepo.update).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('rejects membership ids outside the authorized organization before opening a transaction', async () => {
      mockMembershipRepo.findOne.mockResolvedValue(null);
      await expect(service.renew('foreign-membership')).rejects.toThrow(NotFoundException);
      expect(mockMembershipRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'foreign-membership', organization_id: orgId },
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('publishes MembershipRenewed.v1 on the extending transaction, with the documented payload', async () => {
      prepareRenewal('succeeded');
      await service.renew(dueMembership.id);

      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledTimes(1);
      const [name, version, organizationId, payload, correlationId, causationId, manager] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(name).toBe('MembershipRenewed');
      expect(version).toBe('v1');
      expect(organizationId).toBe(orgId);
      // Field-for-field against MembershipRenewedPayload
      // (packages/contracts/src/events/membership.events.ts:17-22).
      expect(payload).toEqual({
        membershipId: dueMembership.id,
        renewalDate: dueMembership.renewal_date, // the cycle that was settled
        nextPaymentDate: '2025-03-03', // the advanced end/renewal date
        renewalFee: '99.99', // what was actually charged
      });
      expect(correlationId).toBe(dueMembership.id);
      expect(causationId).toBeUndefined();
      // 7th argument = the EntityManager of the surrounding transaction, so the
      // event cannot commit without the date extension (atomicity regression).
      expect(typeof manager.getRepository).toBe('function');
    });

    it('does not extend or re-publish when the cycle was already settled by a concurrent run', async () => {
      // The post-charge lock re-reads a membership whose renewal_date has already
      // advanced past the cycle being settled. The guard must make the extension a
      // no-op rather than granting a free extra period or publishing a second
      // MembershipRenewed.v1 for one payment.
      prepareRenewal('succeeded', {
        ...dueMembership,
        end_date: '2025-03-03',
        renewal_date: '2025-03-03',
      });

      const result = await service.renew(dueMembership.id);

      expect(mockMembershipRepo.update).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
      expect(result.payment.status).toBe('succeeded');
    });
  });

  describe('findAll', () => {
    it('should return paginated memberships', async () => {
      const mockMemberships = [{ id: 'm1' } as Membership];
      mockMembershipRepo.findAndCount.mockResolvedValue([mockMemberships, 1]);
      const result = await service.findAll({ page: 1, limit: 20 });
      expect(result.data).toEqual(mockMemberships);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter by status', async () => {
      mockMembershipRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ status: 'active' });
      expect(mockMembershipRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return membership by id', async () => {
      const membership = { id: 'm1', organization_id: orgId } as Membership;
      mockMembershipRepo.findOne.mockResolvedValue(membership);
      const result = await service.findOne('m1');
      expect(result).toEqual(membership);
    });

    it('should throw NotFoundException when membership not found', async () => {
      mockMembershipRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('m1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByMember', () => {
    it('should return memberships for a member', async () => {
      const memberships = [{ id: 'm1', member_id: 'member-1' } as Membership];
      mockMembershipRepo.findAndCount.mockResolvedValue([memberships, 1]);
      const result = await service.findByMember('member-1', {});
      expect(result.data).toEqual(memberships);
      expect(mockMembershipRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ member_id: 'member-1' }),
        }),
      );
    });
  });

  describe('discounts', () => {
    it('rejects a membership from another organization before creating a discount', async () => {
      mockMembershipRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addDiscount('membership-from-org-b', {
          discount_type: 'fixed',
          amount: 10,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockMembershipRepo.findOne).toHaveBeenCalledWith({
        where: {
          id: 'membership-from-org-b',
          organization_id: orgId,
        },
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(mockDiscountRepo.save).not.toHaveBeenCalled();
    });

    it('locks the membership before checking for an active discount', async () => {
      const membership = { id: 'membership-1', organization_id: orgId } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership);

      await service.addDiscount('membership-1', {
        discount_type: 'fixed',
        amount: 10,
      });

      expect(mockMembershipRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { id: 'membership-1', organization_id: orgId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockMembershipRepo.findOne.mock.invocationCallOrder[1])
        .toBeLessThan(mockDiscountRepo.findOne.mock.invocationCallOrder[0]);
    });

    it('puts the validity window in the duplicate-guard query instead of testing activity after the read', async () => {
      // The pre-fix guard read one arbitrary row and evaluated activity in
      // TypeScript, so a membership holding an expired row NEXT TO an active one
      // slipped through — reproduced against real Postgres in
      // `membership-discount-ambiguity.integration.spec.ts`, which a mock cannot
      // do because it returns whatever row it is handed regardless of the
      // predicate. What a mock CAN pin is the half the guard's caller sees: the
      // predicate reaching the repository, i.e. the decision being taken by the
      // database rather than by the service.
      const membership = { id: 'membership-1', organization_id: orgId } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership);
      mockDiscountRepo.findOne.mockResolvedValueOnce({
        id: 'discount-1',
        membership_id: 'membership-1',
        organization_id: orgId,
        discount_type: 'fixed',
        amount: '10.00',
        starts_at: new Date('2026-01-01T00:00:00.000Z'),
        ends_at: null,
      } as MembershipDiscount);

      await expect(
        service.addDiscount('membership-1', { discount_type: 'fixed', amount: 10 }),
      ).rejects.toThrow(ConflictException);

      expect(mockDiscountRepo.save).not.toHaveBeenCalled();
      const guard = mockDiscountRepo.findOne.mock.calls[0][0] as {
        where: Record<string, unknown>;
        order?: unknown;
      };
      expect(guard.where.membership_id).toBe('membership-1');
      expect(guard.where.organization_id).toBe(orgId);
      // Same tie-break as `renewOne` and `create` (plan §15 Q8 D2 fix).
      expect(guard.order).toEqual(MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER);
      // `starts_at <= now` and `(ends_at IS NULL OR ends_at > now)`. Both are
      // TypeORM FindOperators, so the service cannot evaluate them itself; a
      // revert to the id/org-only predicate drops both keys.
      expect(guard.where.starts_at).toEqual(expect.objectContaining({ _type: 'lessThanOrEqual' }));
      expect(guard.where.ends_at).toEqual(expect.objectContaining({ _type: 'or' }));
    });

    it("maps an insert-time unique violation to the guard's 409 instead of leaking a 500", async () => {
      // A row that starts in the FUTURE (`starts_at > now`, `ends_at IS NULL`) is
      // outside the window predicate above, so the belt check cannot see it and a
      // second open-ended row reaches the INSERT. The partial unique index decides
      // there — same shape as the payout-period race in
      // `commission-payouts.service.ts` — so the caller must see the same 409 the
      // guard throws, not an unhandled QueryFailedError. Both shapes the driver can
      // surface are covered: TypeORM wraps it as `driverError.code`, a bare
      // pg error carries `code`.
      const membership = { id: 'membership-1', organization_id: orgId } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership);
      mockDiscountRepo.findOne.mockResolvedValue(null);
      mockDiscountRepo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockRejectedValueOnce({ code: '23505' });

      for (const _ of [1, 2]) {
        const rejection = (await service
          .addDiscount('membership-1', { discount_type: 'fixed', amount: 5 })
          .catch((error) => error)) as ConflictException;
        expect(rejection).toBeInstanceOf(ConflictException);
        expect(rejection.getStatus()).toBe(409);
        expect(rejection.message).toBe('Membership already has an active discount');
      }
    });

    it('does not swallow an insert error that is not a unique violation', async () => {
      // Only 23505 is translated. An FK (23503) or CHECK (23514) failure is a
      // different defect and must keep its own identity rather than masquerade as
      // "already has an active discount".
      const membership = { id: 'membership-1', organization_id: orgId } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership);
      mockDiscountRepo.findOne.mockResolvedValueOnce(null);
      const dbError = { driverError: { code: '23503' } };
      mockDiscountRepo.save.mockRejectedValueOnce(dbError);

      await expect(
        service.addDiscount('membership-1', { discount_type: 'fixed', amount: 5 }),
      ).rejects.toBe(dbError);
    });

    it('rejects a percentage discount above 100 before it can reach the database', async () => {
      // The table's CHK_membership_discounts_amount allows at most 100 for a
      // percentage, and this API has no QueryFailedError filter, so without this
      // guard a 150% discount would pass DTO validation and surface as a raw 500.
      const membership = { id: 'membership-1', organization_id: orgId } as Membership;
      mockMembershipRepo.findOne.mockResolvedValue(membership);

      await expect(
        service.addDiscount('membership-1', { discount_type: 'percentage', amount: 150 }),
      ).rejects.toThrow(BadRequestException);

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(mockDiscountRepo.save).not.toHaveBeenCalled();
    });

    it('accepts the 100% boundary, which the table constraint allows exactly', async () => {
      const membership = { id: 'membership-1', organization_id: orgId } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership);

      await service.addDiscount('membership-1', { discount_type: 'percentage', amount: 100 });

      expect(mockDiscountRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        membership_id: 'membership-1',
        organization_id: orgId,
        discount_type: 'percentage',
        amount: '100.00',
      }));
    });
  });

  describe('create', () => {
    const createDto = { member_id: 'member-1', plan_id: 'plan-1' };

    const mockPlan = {
      id: 'plan-1', organization_id: orgId, name: 'Basic',
      price: '99.99', currency: 'USD', duration_days: 30, is_active: true,
    } as MembershipPlan;

    beforeEach(() => {
      mockPlanRepo.findOne.mockResolvedValue(mockPlan);
      mockMembershipRepo.create.mockImplementation((dto: any) => dto);
      mockMembershipRepo.save.mockImplementation((dto: any) =>
        Promise.resolve({ id: 'membership-new', ...dto }),
      );
    });

    it('should create a membership successfully', async () => {
      const result = await service.create(createDto);
      expect(result.status).toBe('active');
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'MembershipStarted', 'v1', orgId,
        expect.objectContaining({
          membershipId: 'membership-new',
          memberId: 'member-1',
          planId: 'plan-1',
          startDate: expect.any(String),
          initialFee: '99.99',
        }),
        'membership-new',
        undefined,
        expect.objectContaining({ getRepository: expect.any(Function) }),
      );
    });

    it('writes MembershipStarted through the open transaction manager (atomicity regression)', async () => {
      await service.create(createDto);
      const args = mockOutboxService.saveEventEnvelope.mock.calls[0];
      // 7th argument = the EntityManager of the surrounding transaction; without it
      // the event would commit independently and survive a rolled-back membership.
      expect(args[6]).toBeDefined();
      expect(typeof args[6].getRepository).toBe('function');
    });

    it('should emit a MembershipStarted envelope conforming to EventEnvelope', async () => {
      await service.create(createDto);
      const args = mockOutboxService.saveEventEnvelope.mock.calls[0];
      const [eventType, eventVersion, organizationId, payload, correlationId] = args;
      expect(eventType).toBe('MembershipStarted');
      expect(eventVersion).toBe('v1');
      expect(organizationId).toBe(orgId);
      expect(correlationId).toBe('membership-new');
      // Inner payload contract fields must remain present.
      expect(payload).toEqual(expect.objectContaining({
        membershipId: 'membership-new',
        memberId: 'member-1',
        planId: 'plan-1',
        startDate: expect.any(String),
        initialFee: '99.99',
      }));
    });

    it('should use the authorized org for organizationId and ignore any client-supplied org', async () => {
      // Simulate a hostile client injecting an organization_id into the DTO.
      const hostileDto = { ...createDto, organization_id: 'org-B' };
      await service.create(hostileDto as any);
      const [, , organizationId] = mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(organizationId).toBe(orgId);
      expect(organizationId).not.toBe('org-B');
    });

    it('should throw ConflictException if member already has an active membership', async () => {
      mockMembershipRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('generates the sale invoice inside the membership transaction', async () => {
      await service.create(createDto);

      expect(mockInvoicesService.createForMembershipSale).toHaveBeenCalledWith({
        organizationId: orgId,
        memberId: 'member-1',
        membershipId: 'membership-new',
        branchId: undefined,
        description: 'Membership: Basic',
        amount: '99.99',
        // The invoice must ride the SAME transaction as the membership write, so
        // a rolled-back sale cannot leave an orphan invoice behind.
        manager: expect.objectContaining({ getRepository: expect.any(Function) }),
      });
    });

    it('runs the real membership sale path and persists discounted invoice totals and snapshot', async () => {
      const discount = {
        id: 'discount-1', membership_id: 'membership-new', organization_id: orgId,
        discount_type: 'fixed', amount: '20.00',
        starts_at: new Date('2026-01-01T00:00:00.000Z'), ends_at: null,
      } as MembershipDiscount;
      mockDiscountRepo.findOne.mockResolvedValue(discount);

      const invoiceRepo = {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => ({ ...value, id: 'invoice-1' })),
      };
      const itemRepo = {
        create: jest.fn((value) => value),
        save: jest.fn(async (values) => values.map((value: object) => ({ ...value, id: 'item-1' }))),
      };
      const invoiceDiscountRepo = {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
      };
      const taxLineRepo = { create: jest.fn((value) => value), save: jest.fn(async (values) => values) };
      const saleManager = {
        getRepository: jest.fn((entity: unknown) => {
          if (entity === Invoice) return invoiceRepo;
          if (entity === InvoiceItem) return itemRepo;
          if (entity === InvoiceDiscount) return invoiceDiscountRepo;
          if (entity === TaxLine) return taxLineRepo;
          return {};
        }),
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue({ tax_exempt: false }),
        })),
      } as any;
      const taxRatesService = { resolveActiveRates: jest.fn().mockResolvedValue(new Map()) } as any;
      const invoiceNumberService = { nextInvoiceNumber: jest.fn().mockResolvedValue('INV-000001') } as any;
      const realInvoicesService = Object.create(InvoicesService.prototype) as InvoicesService;
      Object.assign(realInvoicesService, {
        invoiceNumberService,
        taxRatesService,
        outboxService: { saveEventEnvelope: jest.fn().mockResolvedValue(undefined) },
      });
      mockInvoicesService.createForMembershipSale.mockImplementation((input) =>
        InvoicesService.prototype.createForMembershipSale.call(realInvoicesService, {
          ...input,
          manager: saleManager,
        }),
      );

      const result = await service.create(createDto);

      expect(mockInvoicesService.createForMembershipSale).toHaveBeenCalled();
      expect(result.id).toBe('membership-new');

      // The create-path discount read carries the same tie-break (plan §15 Q8 D2 fix).
      const createLookup = mockDiscountRepo.findOne.mock.calls[0][0] as { order?: unknown };
      expect(createLookup.order).toEqual(MEMBERSHIP_DISCOUNT_TIE_BREAK_ORDER);
      expect(invoiceRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        subtotal: '79.99', tax_amount: '0.00', total_amount: '79.99',
      }));
      expect(invoiceDiscountRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        membership_discount_id: 'discount-1', applied_amount: '20.00',
      }));
    });

    it('creates no invoice for a free plan (nothing to charge)', async () => {
      mockPlanRepo.findOne.mockResolvedValue({ ...mockPlan, price: '0.00' });

      await service.create(createDto);

      expect(mockInvoicesService.createForMembershipSale).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if member does not belong to org and emit no event', async () => {
      mockMembershipRepo.findOne.mockResolvedValue(null);
      mockDataSource.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(null),
      }));
      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if plan does not belong to org and emit no event', async () => {
      mockPlanRepo.findOne.mockResolvedValue(null);
      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle transitions', () => {
    const membership = {
      id: 'm1', organization_id: orgId, member_id: 'member-1', status: 'active',
    } as Membership;

    beforeEach(() => {
      mockMembershipRepo.findOne.mockResolvedValue(membership);
      mockMembershipRepo.update.mockResolvedValue({});
      mockHistoryRepo.create.mockImplementation((dto: any) => dto);
      mockHistoryRepo.save.mockResolvedValue({});
    });

    it('should pause an active membership', async () => {
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'paused', paused_at: new Date() });
      const result = await service.pause('m1', { reason: 'Vacation' });
      expect(mockMembershipRepo.update).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ status: 'paused' }),
      );
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith('MembershipPaused', 'v1', orgId, expect.any(Object), 'm1', undefined, expect.objectContaining({ getRepository: expect.any(Function) }));
    });

    it('should resume a paused membership', async () => {
      const pausedMembership = { ...membership, status: 'paused' };
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(pausedMembership)
        .mockResolvedValueOnce({ ...pausedMembership, status: 'active' });
      const result = await service.resume('m1');
      expect(mockMembershipRepo.update).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ status: 'active' }),
      );
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith('MembershipResumed', 'v1', orgId, expect.any(Object), 'm1', undefined, expect.objectContaining({ getRepository: expect.any(Function) }));
    });

    it('should freeze an active membership', async () => {
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'frozen', frozen_at: new Date() });
      const result = await service.freeze('m1');
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith('MembershipFreezeStarted', 'v1', orgId, expect.any(Object), 'm1', undefined, expect.objectContaining({ getRepository: expect.any(Function) }));
    });

    it('should unfreeze a frozen membership', async () => {
      const frozenMembership = { ...membership, status: 'frozen' };
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(frozenMembership)
        .mockResolvedValueOnce({ ...frozenMembership, status: 'active' });
      const result = await service.unfreeze('m1');
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith('MembershipFreezeEnded', 'v1', orgId, expect.any(Object), 'm1', undefined, expect.objectContaining({ getRepository: expect.any(Function) }));
    });

    it('extends end_date by the whole days frozen when unfreezing', async () => {
      // Membership frozen 5 days ago with a known end date; unfreezing today must push
      // the end date forward by those 5 whole days so frozen time is not lost.
      const frozenAt = new Date();
      frozenAt.setUTCDate(frozenAt.getUTCDate() - 5);
      const frozenMembership = {
        ...membership, status: 'frozen', frozen_at: frozenAt, end_date: FUTURE_END_DATE,
      } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(frozenMembership)
        .mockResolvedValueOnce({ ...frozenMembership, status: 'active' });

      await service.unfreeze('m1');

      expect(mockMembershipRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'active', end_date: plusCalendarDays(FUTURE_END_DATE, 5) }),
      );
      // The events remain the same regardless of the extended term.
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'MembershipFreezeEnded', 'v1', orgId, expect.any(Object), 'm1',
        undefined,
        expect.objectContaining({ getRepository: expect.any(Function) }),
      );
    });

    it('should cancel an active membership', async () => {
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'cancelled', cancelled_at: new Date() });
      const result = await service.cancel('m1', { reason: 'Leaving gym' });
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith('MembershipCancelled', 'v1', orgId, expect.any(Object), 'm1', undefined, expect.objectContaining({ getRepository: expect.any(Function) }));
    });

    it('writes lifecycle events through the open transaction manager (atomicity regression)', async () => {
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'paused' });
      await service.pause('m1', { reason: 'Vacation' });
      const args = mockOutboxService.saveEventEnvelope.mock.calls[0];
      // 7th argument = the EntityManager of the surrounding transaction.
      expect(args[6]).toBeDefined();
      expect(typeof args[6].getRepository).toBe('function');
    });

    it('should throw BadRequestException for invalid transition', async () => {
      const cancelledMembership = { ...membership, status: 'cancelled' };
      mockMembershipRepo.findOne.mockResolvedValue(cancelledMembership);
      await expect(service.pause('m1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if membership does not exist', async () => {
      mockMembershipRepo.findOne.mockResolvedValue(null);
      await expect(service.pause('m1')).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * `MembershipResumed.v1` / `MembershipTransferred.v1` / `MembershipFreezeStarted.v1` /
   * `MembershipFreezeEnded.v1` — the four membership events that had no entry in
   * docs/event-contracts.md (the same doc/code drift that had hidden `MembershipExpired.v1`).
   *
   * The lifecycle tests above only assert the event *type*. These pin each emitted payload
   * field-for-field against all three sources at once:
   *   1. the event-type constants in packages/contracts/src/events/membership.events.ts (runtime),
   *   2. the payload interfaces in that same file (compile time, via the `Exact<>` pins below),
   *   3. the JSON schema documented in docs/event-contracts.md (parsed at test time, so the doc
   *      can never silently drift from the emitter again).
   *
   * `MembershipStarted`/`Renewed`/`Paused`/`Cancelled` are deliberately not cross-checked here:
   * their pre-existing doc entries carry optionality drift of their own (the doc shows
   * `pauseEndDate` and `reason` as required where the contract marks both optional), which is
   * outside this task's scope.
   */
  describe('lifecycle event payloads (documented schema conformance)', () => {
    const CONTRACT_PATH = path.resolve(__dirname, '../../../packages/contracts/src/events/membership.events.ts');
    const DOC_PATH = path.resolve(__dirname, '../../../docs/event-contracts.md');
    const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    /** Compile-time key-set equality: the file stops compiling if the contract changes shape. */
    type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const resumedKeysMatchContract: Exact<keyof MembershipResumedPayload, 'membershipId' | 'resumeDate' | 'remainingDays'> = true;
    const freezeStartedKeysMatchContract: Exact<keyof MembershipFreezeStartedPayload, 'membershipId' | 'freezeStartDate' | 'freezeEndDate' | 'freezeDurationDays'> = true;
    const freezeEndedKeysMatchContract: Exact<keyof MembershipFreezeEndedPayload, 'membershipId' | 'freezeEndDate' | 'actualEndDate' | 'daysRemaining'> = true;
    const transferredKeysMatchContract: Exact<keyof MembershipTransferredPayload, 'membershipId' | 'memberId' | 'fromBranchId' | 'toBranchId' | 'transferDate'> = true;

    /** Payload schema documented for `<eventName>` in docs/event-contracts.md. */
    function documentedSchema(eventName: string): { required: string[]; optional: string[] } {
      const markdown = fs.readFileSync(DOC_PATH, 'utf8');
      const bullet = new RegExp(
        '- `' + eventName.replace(/\./g, '\\.') + '`[^\\n]*\\n\\s*```json\\n([\\s\\S]*?)```',
      ).exec(markdown);
      if (!bullet) throw new Error(`docs/event-contracts.md documents no schema for ${eventName}`);
      // The doc (like its attendance section) allows `//` comments inside these JSON blocks.
      const payload = JSON.parse(bullet[1].replace(/\s*\/\/.*$/gm, '')) as Record<string, string>;
      const required: string[] = [];
      const optional: string[] = [];
      for (const [field, type] of Object.entries(payload)) {
        (type.includes('optional') ? optional : required).push(field);
      }
      return { required: required.sort(), optional: optional.sort() };
    }

    /** Field names of `export interface <interfaceName>` in the committed contracts package. */
    function contractSchema(interfaceName: string): { required: string[]; optional: string[] } {
      const source = fs.readFileSync(CONTRACT_PATH, 'utf8');
      const body = new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`).exec(source);
      if (!body) throw new Error(`packages/contracts defines no interface ${interfaceName}`);
      const required: string[] = [];
      const optional: string[] = [];
      for (const line of body[1].split('\n')) {
        const field = /^\s*(\w+)(\?)?:/.exec(line);
        if (field) (field[2] ? optional : required).push(field[1]);
      }
      return { required: required.sort(), optional: optional.sort() };
    }

    /** The single payload the service wrote to the outbox for `eventType`. */
    function emittedPayload(eventType: string): Record<string, unknown> {
      const call = mockOutboxService.saveEventEnvelope.mock.calls.find((c) => c[0] === eventType);
      if (!call) throw new Error(`no ${eventType} event was written to the outbox`);
      // saveEventEnvelope signature: (eventType, eventVersion, organizationId, payload, ...)
      return call[3] as Record<string, unknown>;
    }

    const membership = {
      id: 'm1', organization_id: orgId, member_id: 'member-1', status: 'active',
      end_date: FUTURE_END_DATE,
    } as Membership;

    beforeEach(() => {
      mockMembershipRepo.update.mockResolvedValue({});
      mockHistoryRepo.create.mockImplementation((dto: any) => dto);
      mockHistoryRepo.save.mockResolvedValue({});
    });

    it('resume -> MembershipResumed.v1 matches the documented payload field-for-field', async () => {
      const paused = { ...membership, status: 'paused' } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(paused)
        .mockResolvedValueOnce({ ...paused, status: 'active' });

      await service.resume('m1');

      expect(EVENT_TYPES.MEMBERSHIP_RESUMED).toBe('MembershipResumed');
      const payload = emittedPayload(EVENT_TYPES.MEMBERSHIP_RESUMED);
      expect(Object.keys(payload).sort()).toEqual(['membershipId', 'remainingDays', 'resumeDate']);
      expect(Object.keys(payload).sort()).toEqual(documentedSchema('MembershipResumed.v1').required);
      expect(payload.membershipId).toBe('m1');
      expect(payload.resumeDate).toMatch(ISO_8601);
      // remainingDays = whole calendar days from resumeDate to the membership end_date.
      const expectedRemaining = Math.floor(
        (new Date(`${FUTURE_END_DATE}T00:00:00Z`).getTime() - new Date(payload.resumeDate as string).getTime())
        / (24 * 60 * 60 * 1000),
      );
      expect(payload.remainingDays).toBeGreaterThan(0);
      expect(payload.remainingDays).toBe(expectedRemaining);
      expect(resumedKeysMatchContract).toBe(true);
      expect(EVENT_VERSIONS.V1).toBe('v1');
      // The outbox row keeps the membership as correlation id and the transaction's manager,
      // and is now written as a full EventEnvelope (eventVersion = v1).
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'MembershipResumed', 'v1', orgId, expect.any(Object), 'm1',
        undefined,
        expect.objectContaining({ getRepository: expect.any(Function) }),
      );
      // The inner payload has no envelope-outer fields — those live on the wrapper.
      expect(payload).not.toHaveProperty('eventVersion');
      expect(payload).not.toHaveProperty('eventId');
    });

    it('freeze -> MembershipFreezeStarted.v1 matches the documented payload field-for-field', async () => {
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'frozen' });

      await service.freeze('m1');

      expect(EVENT_TYPES.MEMBERSHIP_FREEZE_STARTED).toBe('MembershipFreezeStarted');
      const payload = emittedPayload(EVENT_TYPES.MEMBERSHIP_FREEZE_STARTED);
      const { required, optional } = documentedSchema('MembershipFreezeStarted.v1');
      expect(Object.keys(payload).sort()).toEqual(['freezeDurationDays', 'freezeStartDate', 'membershipId']);
      expect(Object.keys(payload).sort()).toEqual(required);
      // `freezeEndDate` is documented as optional and the current emitter omits it.
      expect(optional).toEqual(['freezeEndDate']);
      expect(payload.freezeStartDate).toMatch(ISO_8601);
      expect(payload.freezeDurationDays).toBe(0);
      expect(freezeStartedKeysMatchContract).toBe(true);
    });

    it('unfreeze -> MembershipFreezeEnded.v1 matches the documented payload field-for-field', async () => {
      const frozen = { ...membership, status: 'frozen' } as Membership;
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(frozen)
        .mockResolvedValueOnce({ ...frozen, status: 'active' });

      await service.unfreeze('m1');

      expect(EVENT_TYPES.MEMBERSHIP_FREEZE_ENDED).toBe('MembershipFreezeEnded');
      const payload = emittedPayload(EVENT_TYPES.MEMBERSHIP_FREEZE_ENDED);
      expect(Object.keys(payload).sort()).toEqual([
        'actualEndDate', 'daysRemaining', 'freezeEndDate', 'membershipId',
      ]);
      expect(Object.keys(payload).sort()).toEqual(documentedSchema('MembershipFreezeEnded.v1').required);
      expect(payload.freezeEndDate).toMatch(ISO_8601);
      // actualEndDate is the membership's end date in YYYY-MM-DD form, not a timestamp.
      expect(payload.actualEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(payload.actualEndDate).toBe(FUTURE_END_DATE);
      // daysRemaining = whole calendar days from freezeEndDate to actualEndDate.
      const expectedDaysRemaining = Math.max(0, Math.floor(
        (new Date(`${FUTURE_END_DATE}T00:00:00Z`).getTime() - new Date(payload.freezeEndDate as string).getTime())
        / (24 * 60 * 60 * 1000),
      ));
      expect(payload.daysRemaining).toBeGreaterThan(0);
      expect(payload.daysRemaining).toBe(expectedDaysRemaining);
      expect(freezeEndedKeysMatchContract).toBe(true);
    });

    it('every documented membership schema matches the committed contract interface', () => {
      // The four events documented in this task, plus `MembershipExpired.v1` (documented in the
      // previous pass) — the entries whose doc/contract optionality is known to be correct.
      const inScope: Array<[string, string]> = [
        ['MembershipResumed.v1', 'MembershipResumedPayload'],
        ['MembershipTransferred.v1', 'MembershipTransferredPayload'],
        ['MembershipFreezeStarted.v1', 'MembershipFreezeStartedPayload'],
        ['MembershipFreezeEnded.v1', 'MembershipFreezeEndedPayload'],
        ['MembershipExpired.v1', 'MembershipExpiredPayload'],
      ];
      for (const [eventName, interfaceName] of inScope) {
        expect({ [eventName]: documentedSchema(eventName) }).toEqual({
          [eventName]: contractSchema(interfaceName),
        });
      }
      // Only FreezeStarted's `freezeEndDate` is optional; every other field is required.
      expect(documentedSchema('MembershipFreezeStarted.v1').optional).toEqual(['freezeEndDate']);
      expect(documentedSchema('MembershipResumed.v1').required).toEqual([
        'membershipId', 'remainingDays', 'resumeDate',
      ]);
      expect(documentedSchema('MembershipTransferred.v1').required).toEqual([
        'fromBranchId', 'memberId', 'membershipId', 'toBranchId', 'transferDate',
      ]);
      expect(documentedSchema('MembershipFreezeEnded.v1').required).toEqual([
        'actualEndDate', 'daysRemaining', 'freezeEndDate', 'membershipId',
      ]);
    });

    it('MembershipTransferred.v1 is documented but has no producer (flagged, not implemented)', async () => {
      expect(EVENT_TYPES.MEMBERSHIP_TRANSFERRED).toBe('MembershipTransferred');
      expect(transferredKeysMatchContract).toBe(true);
      // No producer exists: there is no `transfer` service method/transition...
      expect((service as any).transfer).toBeUndefined();
      // ...and every lifecycle transition the service does expose emits a *different* event.
      const transitions: Array<[string, string]> = [
        ['pause', 'active'], ['resume', 'paused'], ['freeze', 'active'],
        ['unfreeze', 'frozen'], ['cancel', 'active'], ['expire', 'active'],
      ];
      for (const [method, fromStatus] of transitions) {
        mockMembershipRepo.findOne.mockResolvedValue({ ...membership, status: fromStatus } as Membership);
        await (service as any)[method]('m1');
      }
      expect(mockOutboxService.saveEventEnvelope.mock.calls.map((c) => c[0])).toEqual([
        'MembershipPaused', 'MembershipResumed', 'MembershipFreezeStarted',
        'MembershipFreezeEnded', 'MembershipCancelled', 'MembershipExpired',
      ]);
    });
  });

  /**
   * `MembershipExpired.v1` — the event the membership-expiry worker publishes.
   *
   * The Phase 1 verification run only ever saw the worker tick as a no-op (0
   * memberships due), so the event itself was never exercised. These tests run
   * `expireDueMemberships` synchronously (it is the exact method
   * `MembershipExpiryWorker.runOnce` calls) and assert both the transition and
   * every field of the published payload against the committed contract
   * `MembershipExpiredPayload` in packages/contracts/src/events/membership.events.ts.
   */
  describe('expireDueMemberships (MembershipExpired.v1)', () => {
    const TODAY = '2026-09-14';

    // A membership the scan considers due: still active, end_date in the past.
    const dueMembership = {
      id: 'mem-due',
      organization_id: orgId,
      member_id: 'member-due',
      status: 'active',
      start_date: '2026-08-01',
      end_date: '2026-09-01',
    } as unknown as Membership;

    it('transitions active -> expired and publishes a contract-complete MembershipExpired.v1', async () => {
      membershipQueryBuilder.getMany.mockResolvedValue([dueMembership]);
      mockMembershipRepo.findOne.mockResolvedValue(dueMembership);
      mockMembershipRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.expireDueMemberships({ limit: 200, today: TODAY });

      // 1. the batch reports what it actually transitioned
      expect(result).toEqual({ scanned: 1, expired: 1, membershipIds: ['mem-due'] });

      // 2. the status write, scoped by the row's own organization_id
      expect(mockMembershipRepo.update).toHaveBeenCalledTimes(1);
      expect(mockMembershipRepo.update).toHaveBeenCalledWith(
        { id: 'mem-due', organization_id: orgId },
        { status: 'expired' },
      );

      // 3. the audit trail row
      expect(mockHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          membership_id: 'mem-due',
          organization_id: orgId,
          member_id: 'member-due',
          from_status: 'active',
          to_status: 'expired',
          transition: 'expire',
        }),
      );
      expect(mockHistoryRepo.save).toHaveBeenCalledTimes(1);

      // 4. the event: exactly one, every field checked against the contract
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledTimes(1);
      const [
        eventType,
        eventVersion,
        organizationId,
        payload,
        correlationId,
        causationId,
        manager,
      ] = mockOutboxService.saveEventEnvelope.mock.calls[0];

      expect(eventType).toBe('MembershipExpired');
      expect(eventVersion).toBe('v1');
      expect(organizationId).toBe(orgId); // from the row: no tenant context in a worker
      expect(correlationId).toBe('mem-due');
      expect(causationId).toBeUndefined();
      expect(manager).toBeDefined(); // written on the domain transaction
      expect(typeof manager.getRepository).toBe('function');

      // No extra/renamed fields: `endDate` is optional, the rest are required.
      expect(Object.keys(payload).sort()).toEqual(['endDate', 'expiredAt', 'memberId', 'membershipId']);
      expect(payload.membershipId).toBe('mem-due');
      expect(payload.memberId).toBe('member-due');
      // contract: ISO-8601 timestamp (canonical, round-trips through Date)
      expect(typeof payload.expiredAt).toBe('string');
      expect(new Date(payload.expiredAt).toISOString()).toBe(payload.expiredAt);
      // contract: the end date that was reached, YYYY-MM-DD (a `date` column, so
      // the envelope stays JSON-stable instead of leaking a Date object)
      expect(typeof payload.endDate).toBe('string');
      expect(payload.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(payload.endDate).toBe('2026-09-01');
    });

    it('scans only non-terminal memberships whose end date is before today', async () => {
      await service.expireDueMemberships({ limit: 25, today: TODAY });

      expect(membershipQueryBuilder.where).toHaveBeenCalledWith(
        'membership.status IN (:...statuses)',
        { statuses: NON_TERMINAL_STATUSES },
      );
      expect(NON_TERMINAL_STATUSES).not.toContain('expired');
      expect(membershipQueryBuilder.andWhere).toHaveBeenCalledWith('membership.end_date IS NOT NULL');
      expect(membershipQueryBuilder.andWhere).toHaveBeenCalledWith(
        'membership.end_date < :today',
        { today: TODAY },
      );
      expect(membershipQueryBuilder.limit).toHaveBeenCalledWith(25);
      expect(membershipQueryBuilder.getMany).toHaveBeenCalledTimes(1);
    });

    it('leaves a membership whose end date has not passed untouched', async () => {
      membershipQueryBuilder.getMany.mockResolvedValue([dueMembership]);
      mockMembershipRepo.findOne.mockResolvedValue({
        ...dueMembership,
        end_date: FUTURE_END_DATE,
      } as Membership);

      const result = await service.expireDueMemberships({ today: TODAY });

      expect(result).toEqual({ scanned: 1, expired: 0, membershipIds: [] });
      expect(mockMembershipRepo.update).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('does not expire a membership whose renewal charge is still open (dunning owns the debt)', async () => {
      // Renewal only extends the membership AFTER a charge succeeds, so a member
      // whose renewal payment is still pending has a past end_date. Expiring them
      // would lapse the membership while the renewal is still being collected —
      // the exact double-effect the renewal path is written to avoid. The open
      // renewal invoice is the hand-off to P3-08's dunning, which owns the chase.
      const withRenewal = { ...dueMembership, renewal_date: '2026-09-01' } as Membership;
      membershipQueryBuilder.getMany.mockResolvedValue([withRenewal]);
      mockMembershipRepo.findOne.mockResolvedValue(withRenewal);
      mockInvoiceRenewalQuery.getOne.mockResolvedValue({ id: 'open-renewal-invoice' });

      const result = await service.expireDueMemberships({ limit: 200, today: TODAY });

      expect(result).toEqual({ scanned: 1, expired: 0, membershipIds: [] });
      expect(mockMembershipRepo.update).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();

      // The lookup is scoped to the candidate's own organization and only an
      // UNPAID renewal invoice blocks the expiry.
      expect(mockInvoiceRenewalQuery.where).toHaveBeenCalledWith(
        'invoice.organization_id = :organizationId',
        { organizationId: orgId },
      );
      expect(mockInvoiceRenewalQuery.andWhere).toHaveBeenCalledWith(
        'invoice.status IN (:...statuses)',
        { statuses: ['sent', 'partially_paid'] },
      );
    });

    it('still expires a past-due membership once its renewal debt is settled (the guard is not over-broad)', async () => {
      // The counterfactual to the test above: a settled renewal must not silently
      // disable expiry, or past-due members would never lapse.
      const withRenewal = { ...dueMembership, renewal_date: '2026-09-01' } as Membership;
      membershipQueryBuilder.getMany.mockResolvedValue([withRenewal]);
      mockMembershipRepo.findOne.mockResolvedValue(withRenewal);
      mockInvoiceRenewalQuery.getOne.mockResolvedValue(null);

      const result = await service.expireDueMemberships({ limit: 200, today: TODAY });

      expect(result).toEqual({ scanned: 1, expired: 1, membershipIds: ['mem-due'] });
      expect(mockMembershipRepo.update).toHaveBeenCalledWith(
        { id: 'mem-due', organization_id: orgId },
        { status: 'expired' },
      );
    });

    it('never double-publishes when a concurrent run already expired the row', async () => {
      membershipQueryBuilder.getMany.mockResolvedValue([dueMembership]);
      mockMembershipRepo.findOne.mockResolvedValue({
        ...dueMembership,
        status: 'expired',
      } as Membership);

      const result = await service.expireDueMemberships({ today: TODAY });

      expect(result.expired).toBe(0);
      expect(mockMembershipRepo.update).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('ignores a candidate that disappeared between the scan and the locked re-read', async () => {
      membershipQueryBuilder.getMany.mockResolvedValue([dueMembership]);
      mockMembershipRepo.findOne.mockResolvedValue(null);

      const result = await service.expireDueMemberships({ today: TODAY });

      expect(result).toEqual({ scanned: 1, expired: 0, membershipIds: [] });
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });
// --------------------------------------------------------------------------
  // Envelope conformance (lifecycle transition events are now routable)
  // --------------------------------------------------------------------------

  describe('lifecycle transition envelope conformance', () => {
    const membership = {
      id: 'm1', organization_id: orgId, member_id: 'member-1', status: 'active',
      end_date: FUTURE_END_DATE,
    } as Membership;

    beforeEach(() => {
      mockMembershipRepo.update.mockResolvedValue({});
      mockHistoryRepo.create.mockImplementation((dto: any) => dto);
      mockHistoryRepo.save.mockResolvedValue({});
    });

    it('each lifecycle event is written as a full EventEnvelope (version v1, org, correlationId)', async () => {
      // pause
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'paused' });
      await service.pause('m1', { reason: 'Vacation' });

      const pauseCall = mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(pauseCall[0]).toBe('MembershipPaused');
      expect(pauseCall[1]).toBe('v1');
      expect(pauseCall[2]).toBe(orgId);
      expect(pauseCall[4]).toBe('m1'); // correlationId = membership id
      expect(pauseCall[6]).toBeDefined(); // manager

      // cancel
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'cancelled' });
      await service.cancel('m1', { reason: 'Leaving' });
      const cancelCall = mockOutboxService.saveEventEnvelope.mock.calls[1];
      expect(cancelCall[0]).toBe('MembershipCancelled');
      expect(cancelCall[1]).toBe('v1');
      expect(cancelCall[2]).toBe(orgId);
      expect(cancelCall[4]).toBe('m1');

      // expire via transitionState
      mockMembershipRepo.findOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce({ ...membership, status: 'expired' });
      await service.expire('m1');
      const expireCall = mockOutboxService.saveEventEnvelope.mock.calls[2];
      expect(expireCall[0]).toBe('MembershipExpired');
      expect(expireCall[1]).toBe('v1');
      expect(expireCall[2]).toBe(orgId);
      expect(expireCall[4]).toBe('m1');
    });
  });
  });
});
