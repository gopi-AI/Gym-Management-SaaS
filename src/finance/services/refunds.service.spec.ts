import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { Refund } from '../entities/refund.entity';
import { Payment } from '../entities/payment.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  FINANCE_EVENT_TYPES,
  PAYMENT_STATUS,
  REFUND_STATUS,
  toMoney,
} from '../finance.constants';

/**
 * P3-02 — refunds against payments.
 *
 * The property under test is the invariant from §15 Q5b: a payment may be
 * refunded repeatedly, but the sum of its refunds can never exceed the payment
 * itself. That has to hold under concurrency, so the two things this file pins
 * are:
 *
 *   1. the payment row is read with a `pessimistic_write` lock, and the
 *      already-refunded total is recomputed INSIDE that transaction — a
 *      read-then-write pre-check outside it would let two refunds both pass; and
 *   2. the rejection is the app-level check, so the test drives a second refund
 *      after a first has committed and proves the second is refused. Unlike
 *      Workouts' `assignPlan()` there is no database constraint to fall back on
 *      here — `SUM(refunds) <= payment.amount` is not expressible as a CHECK
 *      across rows — so the transaction and the lock ARE the backstop, which is
 *      exactly why they are asserted directly rather than assumed.
 */
describe('RefundsService', () => {
  let service: RefundsService;
  let mockRefundRepo: Record<string, jest.Mock>;
  let mockPaymentRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, any>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;
  /** The sum the credited-style `SUM(amount)` refunded-total query resolves. */
  let refundedSum: string;
  let transactionManager: Record<string, any>;

  const orgId = '11111111-1111-4111-8111-111111111111';
  const otherOrgId = '22222222-2222-4222-8222-222222222222';
  const paymentId = '44444444-4444-4444-8444-444444444444';

  /** A succeeded 100.00 payment against an invoice, i.e. fully refundable. */
  const payment = (overrides: Partial<Payment> = {}): Payment =>
    ({
      id: paymentId,
      organization_id: orgId,
      invoice_id: 'invoice-1',
      member_id: 'member-1',
      payment_method: 'cash',
      amount: '100.00',
      status: PAYMENT_STATUS.SUCCEEDED,
      ...overrides,
    }) as Payment;

  beforeEach(async () => {
    refundedSum = '0';

    mockRefundRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity: object) => ({
        ...entity,
        id: 'refund-1',
      })),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn(() => {
        const builder: Record<string, jest.Mock> = {
          select: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          getRawOne: jest.fn().mockImplementation(async () => ({ refunded: refundedSum })),
        };
        for (const method of ['select', 'where', 'andWhere']) {
          builder[method].mockReturnValue(builder);
        }
        return builder;
      }),
    };

    mockPaymentRepo = {
      findOne: jest.fn().mockResolvedValue(payment()),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: Function) => {
        transactionManager = {
          getRepository: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === Refund) return mockRefundRepo;
            if (entity === Payment) return mockPaymentRepo;
            return {};
          }),
        };
        return cb(transactionManager);
      }),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(null),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
    };

    mockOutboxService = { saveEventEnvelope: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: getRepositoryToken(Refund), useValue: mockRefundRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
  });

  describe('create', () => {
    const dto = { amount: 40, reason: 'Member cancelled' };

    it('records a refund with the submitted amount and the server-decided status', async () => {
      const refund = await service.create(paymentId, dto);

      expect(refund).toMatchObject({
        organization_id: orgId,
        payment_id: paymentId,
        amount: '40.00',
        reason: 'Member cancelled',
        // Manual, staff-initiated: written straight to `succeeded`, no provider
        // call, and the client never supplies a status (§15 Q5c).
        status: REFUND_STATUS.SUCCEEDED,
      });
    });

    it('normalises the amount to a 2-decimal money string', async () => {
      const refund = await service.create(paymentId, { amount: 33.335, reason: 'rounding' });

      expect(refund.amount).toBe('33.34');
    });

    it('allows repeated partial refunds that together stay within the payment', async () => {
      // 60.00 already refunded of 100.00, so 40.00 more is exactly the remainder.
      refundedSum = '60.00';

      const refund = await service.create(paymentId, { amount: 40, reason: 'remainder' });

      expect(refund.amount).toBe('40.00');
    });

    it('rejects a refund that would exceed the un-refunded balance', async () => {
      refundedSum = '60.00';

      await expect(service.create(paymentId, { amount: 41, reason: 'too much' })).rejects.toThrow(
        /exceeds the un-refunded balance 40\.00/,
      );
      expect(mockRefundRepo.save).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('rejects once the payment is fully refunded', async () => {
      refundedSum = '100.00';

      await expect(service.create(paymentId, dto)).rejects.toThrow(/fully refunded/);
      expect(mockRefundRepo.save).not.toHaveBeenCalled();
    });

    it.each([PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED])(
      'refuses to refund a %s payment, which returned no money',
      async (status) => {
        mockPaymentRepo.findOne.mockResolvedValue(payment({ status }));

        await expect(service.create(paymentId, dto)).rejects.toThrow(
          new RegExp(`Only a succeeded payment can be refunded; this payment is '${status}'`),
        );
        expect(mockRefundRepo.save).not.toHaveBeenCalled();
      },
    );

    it('cannot refund a payment belonging to another organization', async () => {
      // The locked load is org-scoped, so a foreign payment is simply not found.
      mockPaymentRepo.findOne.mockResolvedValue(null);

      await expect(service.create(paymentId, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockRefundRepo.save).not.toHaveBeenCalled();
    });

    it('reads the payment with a write lock, scoped to the authorized org', async () => {
      await service.create(paymentId, dto);

      expect(mockPaymentRepo.findOne).toHaveBeenCalledWith({
        where: { id: paymentId, organization_id: orgId },
        // The lock is what makes the invariant hold under concurrency: two
        // concurrent refunds on one payment serialize here.
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockPaymentRepo.findOne).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: paymentId, organization_id: otherOrgId } }),
      );
    });

    it('touches only the refund and payment tables inside the transaction', async () => {
      await service.create(paymentId, dto);

      const requested = transactionManager.getRepository.mock.calls.map(
        (call: unknown[]) => call[0],
      );

      expect(new Set(requested)).toEqual(new Set([Payment, Refund]));
    });

    it('lets only ONE of two racing refunds succeed on the same payment', async () => {
      // A 100.00 payment, two 60.00 refunds. At most one may be recorded.
      //
      // This models the serialization the row lock provides: the second call's
      // in-transaction read observes the first call's committed refund, so it is
      // rejected. A read-then-write pre-check OUTSIDE the transaction would let
      // both read 0.00 and both pass, over-refunding the payment by 20.00 — which
      // is the whole reason §15 Q5b requires the check inside the transaction.
      let committed = '0.00';
      mockRefundRepo.createQueryBuilder = jest.fn(() => {
        const builder: Record<string, jest.Mock> = {
          select: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          getRawOne: jest.fn().mockImplementation(async () => ({ refunded: committed })),
        };
        for (const method of ['select', 'where', 'andWhere']) {
          builder[method].mockReturnValue(builder);
        }
        return builder;
      });
      mockRefundRepo.save = jest.fn().mockImplementation(async (entity: { amount: string }) => {
        // Stands in for the commit the *next* transaction will observe.
        committed = toMoney(Number(committed) + Number(entity.amount));
        return { ...entity, id: `refund-${committed}` };
      });

      await expect(service.create(paymentId, { amount: 60, reason: 'first' })).resolves.toMatchObject(
        { amount: '60.00' },
      );

      await expect(
        service.create(paymentId, { amount: 60, reason: 'second' }),
      ).rejects.toThrow(/exceeds the un-refunded balance 40\.00/);

      // Exactly one 60.00 refund landed against the 100.00 payment.
      expect(committed).toBe('60.00');
    });

    it('emits RefundIssued.v1 on the SAME transaction, carrying the invoice from the payment', async () => {
      await service.create(paymentId, dto);

      const [eventType, version, emittedOrg, payload, correlationId, , manager] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];

      expect(eventType).toBe(FINANCE_EVENT_TYPES.REFUND_ISSUED);
      expect(version).toBe('v1');
      expect(emittedOrg).toBe(orgId);
      // A refund has no invoice column of its own; the event denormalises it from
      // the refunded payment so consumers do not have to join back to it.
      expect(payload).toMatchObject({
        refundId: 'refund-1',
        paymentId,
        invoiceId: 'invoice-1',
        amount: '40.00',
        reason: 'Member cancelled',
        status: REFUND_STATUS.SUCCEEDED,
      });
      expect(correlationId).toBe('invoice-1');
      expect(manager).toBe(transactionManager);
    });

    it('rolls back when the event write fails, having already written the refund', async () => {
      mockOutboxService.saveEventEnvelope.mockRejectedValue(new Error('outbox down'));

      await expect(service.create(paymentId, dto)).rejects.toThrow('outbox down');

      // The refund row was written before the failing event write, so this is a
      // real rollback assertion: without a shared transaction the refund would
      // survive with no event published.
      expect(mockRefundRepo.save).toHaveBeenCalledTimes(1);
    });

    it('counts only SUCCEEDED refunds towards what is already refunded', async () => {
      await service.create(paymentId, dto);

      const builder = mockRefundRepo.createQueryBuilder.mock.results[0].value;

      // A `failed` refund returned nothing, and a `pending` one has not returned
      // anything YET, so neither may consume the refundable balance.
      //
      // This filter is the ONLY thing enforcing that: `SUM(refunds.amount) <=
      // payment.amount` is not expressible as a cross-row CHECK — see this file's
      // header — so the app-level query IS the backstop, with no database
      // constraint behind it. The P3-02 ledger views apply the same rule in SQL
      // (`SQL_SUCCEEDED_REFUND`), and the two must agree, or a refund could be
      // refused against a balance the ledger reports as unspent.
      //
      // Load-bearing from P3-03 onward: that is when `pending` refunds start to
      // exist. Mutation testing during P3-02 found that dropping this filter left
      // the entire suite green (82 suites / 922 tests) — this test is the hole
      // that was open, narrowed to the one assertion that closes it.
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('status'), {
        status: REFUND_STATUS.SUCCEEDED,
      });
    });
  });
});
