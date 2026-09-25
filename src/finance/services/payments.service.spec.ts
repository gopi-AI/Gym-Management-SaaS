import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { InvoicesService } from './invoices.service';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  FINANCE_EVENT_TYPES,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  toMoney,
} from '../finance.constants';
import { PAYMENT_GATEWAY } from './payment-gateway.port';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Behavioral verification of payment recording and retry application.
 *
 * The properties that matter: a payment can never be double-recorded
 * (idempotency key), a payment can never exceed the DERIVED outstanding balance
 * (the invoice carries no balance column to trust), and the invoice status is
 * recomputed from the payments that exist rather than incremented.
 */
describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPaymentRepo: Record<string, jest.Mock>;
  let mockInvoiceRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, any>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;
  let mockInvoicesService: Record<string, jest.Mock>;
  let mockPaymentMethodsService: Record<string, jest.Mock>;
  let mockPaymentGateway: { charge: jest.Mock; isConfigured: boolean };

  const orgId = '11111111-1111-4111-8111-111111111111';
  const memberId = '22222222-2222-4222-8222-222222222222';
  const invoiceId = '33333333-3333-4333-8333-333333333333';

  const sentInvoice: Invoice = {
    id: invoiceId,
    organization_id: orgId,
    branch_id: null,
    member_id: memberId,
    membership_id: null,
    invoice_number: 'INV-000001',
    invoice_date: new Date('2026-02-01T00:00:00.000Z'),
    due_date: new Date('2026-02-15T00:00:00.000Z'),
    subtotal: '65.00',
    tax_amount: '0.00',
    total_amount: '65.00',
    status: INVOICE_STATUS.SENT,
    paid_at: null,
    created_at: new Date('2026-02-01T00:00:00.000Z'),
    updated_at: new Date('2026-02-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    mockPaymentRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity: object) => ({
        ...entity,
        id: 'payment-1',
      })),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    mockInvoiceRepo = {
      findOne: jest.fn().mockResolvedValue(sentInvoice),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: Function) =>
        cb({
          getRepository: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === Payment) return mockPaymentRepo;
            if (entity === Invoice) return mockInvoiceRepo;
            return {};
          }),
        }),
      ),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ '?column?': 1 }),
      })),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(null),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
    };

    mockOutboxService = { saveEventEnvelope: jest.fn().mockResolvedValue({}) };

    mockInvoicesService = {
      loadInvoiceForUpdate: jest.fn().mockResolvedValue({ ...sentInvoice }),
      // Default: nothing collected yet, so the full 65.00 is outstanding.
      paymentTotalsByInvoice: jest.fn().mockResolvedValue(new Map()),
      // P3-02: `recordForInvoice` and `applySuccessfulPaymentToInvoice` both
      // measure the balance net of credit notes. Default is no credit notes, so
      // every Phase 1 assertion keeps seeing the payments-only balance.
      creditNoteTotalsByInvoice: jest.fn().mockResolvedValue(new Map()),
    };

    mockPaymentMethodsService = {
      getDefaultPaymentMethod: jest.fn().mockResolvedValue({
        stripe_customer_id: 'cus-1',
        stripe_payment_method_id: 'pm-1',
      }),
      getDefaultPaymentMethodForOrganization: jest.fn().mockResolvedValue({
        stripe_customer_id: 'cus-1',
        stripe_payment_method_id: 'pm-1',
      }),
    };
    mockPaymentGateway = { charge: jest.fn().mockResolvedValue({ succeeded: true, transactionId: 'renewal-txn' }), isConfigured: true };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepo },
        { provide: getRepositoryToken(Invoice), useValue: mockInvoiceRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: InvoicesService, useValue: mockInvoicesService },
        { provide: PaymentMethodsService, useValue: mockPaymentMethodsService },
        {
          provide: PAYMENT_GATEWAY,
          useValue: mockPaymentGateway,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('process', () => {
    it('rejects a pending payment when the member has no saved payment method', async () => {
      const pendingPayment = {
        id: 'payment-pending-1',
        organization_id: orgId,
        member_id: memberId,
        invoice_id: invoiceId,
        amount: '65.00',
        status: PAYMENT_STATUS.PENDING,
      } as Payment;
      mockPaymentRepo.findOne.mockResolvedValue(pendingPayment);
      mockPaymentMethodsService.getDefaultPaymentMethod.mockResolvedValue(null);

      await expect(service.process(pendingPayment.id)).rejects.toThrow('NO_SAVED_PAYMENT_METHOD');
      expect(mockPaymentMethodsService.getDefaultPaymentMethod).toHaveBeenCalledWith(memberId);
    });
  });

  describe('attemptWithSavedMethod (worker renewal/retry)', () => {
    it('scopes the payment and saved method to its organization and applies outcome through shared path', async () => {
      const pendingPayment = {
        id: 'renewal-payment', organization_id: orgId, member_id: memberId,
        invoice_id: invoiceId, amount: '65.00', status: PAYMENT_STATUS.PENDING,
        retry_count: 0, next_retry_at: null,
      } as Payment;
      mockPaymentRepo.findOne.mockResolvedValue(pendingPayment);
      const applySpy = jest.spyOn(service, 'applyRetryOutcome').mockResolvedValue({
        status: PAYMENT_STATUS.SUCCEEDED, retryCount: 1, exhausted: false,
      });
      const now = new Date('2026-09-24T00:00:00.000Z');

      await expect(service.attemptWithSavedMethod(pendingPayment, now, 1)).resolves.toMatchObject({
        status: PAYMENT_STATUS.SUCCEEDED,
      });

      expect(mockPaymentRepo.findOne).toHaveBeenCalledWith({
        where: { id: pendingPayment.id, organization_id: orgId },
      });
      expect(mockPaymentMethodsService.getDefaultPaymentMethodForOrganization).toHaveBeenCalledWith(memberId, orgId);
      expect(mockPaymentGateway.charge).toHaveBeenCalledWith(pendingPayment, expect.objectContaining({
        stripe_customer_id: 'cus-1', stripe_payment_method_id: 'pm-1',
      }));
      expect(applySpy).toHaveBeenCalledWith(
        pendingPayment.id,
        expect.objectContaining({ succeeded: true, transactionId: 'renewal-txn' }),
        { maxAttempts: 1, now },
      );
    });
  });

  describe('recordForInvoice', () => {
    it('records a succeeded payment, settles the invoice and emits PaymentSucceeded.v1', async () => {
      mockInvoicesService.paymentTotalsByInvoice
        .mockResolvedValueOnce(new Map()) // balance check before the insert
        .mockResolvedValueOnce(new Map([[invoiceId, '65.00']])); // recompute after the insert

      const payment = await service.recordForInvoice(invoiceId, {
        amount: 65,
        payment_method: 'cash',
        idempotency_key: 'desk-key-1',
      });

      expect(payment.status).toBe(PAYMENT_STATUS.SUCCEEDED);
      expect(mockPaymentRepo.create.mock.calls[0][0]).toMatchObject({
        organization_id: orgId,
        member_id: memberId,
        invoice_id: invoiceId,
        amount: '65.00',
        payment_method: 'cash',
        status: PAYMENT_STATUS.SUCCEEDED,
        idempotency_key: 'desk-key-1',
        next_retry_at: null,
      });

      expect(mockInvoiceRepo.update).toHaveBeenCalledWith(
        { id: invoiceId, organization_id: orgId },
        { status: INVOICE_STATUS.PAID, paid_at: expect.any(Date) },
      );

      const [eventType, , organizationId, payload, correlationId, , manager] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(eventType).toBe(FINANCE_EVENT_TYPES.PAYMENT_SUCCEEDED);
      expect(organizationId).toBe(orgId);
      expect(payload).toMatchObject({ invoiceId, amount: '65.00', paymentMethod: 'cash' });
      expect(correlationId).toBe(invoiceId);
      expect(manager).toBeDefined();
    });

    it('moves the invoice to partially_paid and leaves paid_at null on a partial payment', async () => {
      mockInvoicesService.paymentTotalsByInvoice.mockResolvedValue(new Map([[invoiceId, '20.00']]));

      await service.recordForInvoice(invoiceId, { amount: 20, payment_method: 'card' });

      expect(mockInvoiceRepo.update).toHaveBeenCalledWith(
        { id: invoiceId, organization_id: orgId },
        { status: INVOICE_STATUS.PARTIALLY_PAID, paid_at: null },
      );
    });

    it('returns the first payment when the same idempotency key is replayed', async () => {
      const existing = { id: 'payment-existing', idempotency_key: 'desk-key-1' } as Payment;
      mockPaymentRepo.findOne.mockResolvedValue(existing);

      const payment = await service.recordForInvoice(invoiceId, {
        amount: 65,
        payment_method: 'cash',
        idempotency_key: 'desk-key-1',
      });

      expect(payment).toBe(existing);
      expect(mockPaymentRepo.save).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('generates an idempotency key when the client supplies none', async () => {
      await service.recordForInvoice(invoiceId, { amount: 10, payment_method: 'cash' });

      const created = mockPaymentRepo.create.mock.calls[0][0] as Payment;
      expect(created.idempotency_key).toMatch(new RegExp(`^manual:${invoiceId}:`));
    });

    it('rejects a payment larger than the outstanding balance', async () => {
      mockInvoicesService.paymentTotalsByInvoice.mockResolvedValue(new Map([[invoiceId, '40.00']]));

      await expect(
        service.recordForInvoice(invoiceId, { amount: 30, payment_method: 'cash' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a payment against an invoice that is already settled', async () => {
      mockInvoicesService.paymentTotalsByInvoice.mockResolvedValue(
        new Map([[invoiceId, '65.00']]),
      );

      await expect(
        service.recordForInvoice(invoiceId, { amount: 1, payment_method: 'cash' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a payment against a draft or voided invoice', async () => {
      mockInvoicesService.loadInvoiceForUpdate.mockResolvedValue({
        ...sentInvoice,
        status: INVOICE_STATUS.VOID,
      });

      await expect(
        service.recordForInvoice(invoiceId, { amount: 5, payment_method: 'cash' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('returns the winner of a concurrent duplicate instead of failing on the unique index', async () => {
      const winner = { id: 'payment-winner', idempotency_key: 'race-key' } as Payment;
      mockPaymentRepo.save.mockRejectedValue({ driverError: { code: '23505' } });
      mockPaymentRepo.findOne
        .mockResolvedValueOnce(null) // in-transaction replay check
        .mockResolvedValueOnce(winner); // post-conflict lookup

      const payment = await service.recordForInvoice(invoiceId, {
        amount: 65,
        payment_method: 'cash',
        idempotency_key: 'race-key',
      });

      expect(payment).toBe(winner);
    });
  });

  describe('P3-02 — the balance is measured net of credit notes', () => {
    it('rejects a payment that would over-pay an invoice already reduced by a credit note', async () => {
      // 65.00 invoice with a 15.00 credit note leaves only 50.00 owed, so a 60.00
      // payment must be refused. Before P3-02 the guard compared against the
      // un-credited 65.00 and would have accepted it.
      mockInvoicesService.creditNoteTotalsByInvoice.mockResolvedValue(
        new Map([[invoiceId, '15.00']]),
      );

      await expect(
        service.recordForInvoice(invoiceId, { amount: 60, payment_method: 'cash' }),
      ).rejects.toThrow(/exceeds the outstanding balance 50\.00/);

      expect(mockPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('settles a credited invoice once payments cover the REMAINING balance', async () => {
      // 65.00 invoice, 15.00 credited -> 50.00 owed. A 50.00 payment settles it,
      // even though the payment (50.00) is less than the invoice total (65.00).
      // Without the credit term the invoice would be stuck in `partially_paid`
      // forever, because the over-payment guard refuses the extra 15.00 that
      // would otherwise be needed to cross the threshold.
      mockInvoicesService.creditNoteTotalsByInvoice.mockResolvedValue(
        new Map([[invoiceId, '15.00']]),
      );
      mockInvoicesService.paymentTotalsByInvoice
        // First read: the over-payment guard, BEFORE the payment is inserted.
        .mockResolvedValueOnce(new Map())
        // Second read: `applySuccessfulPaymentToInvoice`, which recomputes the
        // balance from the payments table AFTER the insert.
        .mockResolvedValueOnce(new Map([[invoiceId, '50.00']]));

      const payment = await service.recordForInvoice(invoiceId, {
        amount: 50,
        payment_method: 'cash',
      });

      expect(payment.amount).toBe('50.00');
      expect(mockInvoiceRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: invoiceId }),
        // INVOICE_STATUS.PAID — written literally because this spec asserts on
        // the persisted status value, not on the constant.
        expect.objectContaining({ status: 'paid' }),
      );
    });

    it('reaches paid through the full sequence: partial payment -> credit note -> remainder', async () => {
      // THE SEQUENCE, not a single call.
      //
      // The two tests above each exercise ONE call. The first never inserts a
      // payment at all. The second scripts `paymentTotalsByInvoice` to return the
      // post-insert total via `mockResolvedValueOnce` — it ASSERTS what the
      // recomputed balance will be rather than deriving it, so it cannot show that
      // a partial payment and a credit note COMPOSE.
      //
      // That composition is exactly what the Phase 1 rule got wrong: the settled
      // test read payments alone, so a credited invoice could never cross
      // `total_amount` without over-paying the member by the credited amount.
      //
      // So the totals methods below read from mutable ledger state, and the insert
      // is what moves it — the same way `SUM(succeeded payments)` would in the
      // database. Nothing about the outcome is pre-scripted.
      let paid = '0.00';
      let credited = '0.00';
      let status: Invoice['status'] = INVOICE_STATUS.SENT;
      let paidAt: Date | null = null;

      mockInvoicesService.loadInvoiceForUpdate.mockImplementation(async () => ({
        ...sentInvoice,
        status,
        paid_at: paidAt,
      }));
      mockInvoicesService.paymentTotalsByInvoice.mockImplementation(async () =>
        Number(paid) > 0 ? new Map([[invoiceId, paid]]) : new Map(),
      );
      mockInvoicesService.creditNoteTotalsByInvoice.mockImplementation(async () =>
        Number(credited) > 0 ? new Map([[invoiceId, credited]]) : new Map(),
      );
      mockPaymentRepo.save.mockImplementation(async (entity: Payment) => {
        paid = toMoney(Number(paid) + Number(entity.amount));
        return { ...entity, id: `payment-${paid}` };
      });
      // Mirror the status write back into the fake invoice row, so the NEXT call's
      // `loadInvoiceForUpdate` sees what the previous call persisted.
      mockInvoiceRepo.update.mockImplementation(
        async (_where: object, patch: { status: Invoice['status']; paid_at: Date | null }) => {
          status = patch.status;
          paidAt = patch.paid_at;
          return { affected: 1 };
        },
      );

      // 1. A partial payment of 20.00 against the 65.00 invoice.
      await service.recordForInvoice(invoiceId, { amount: 20, payment_method: 'cash' });
      expect(mockInvoiceRepo.update).toHaveBeenLastCalledWith(
        { id: invoiceId, organization_id: orgId },
        { status: INVOICE_STATUS.PARTIALLY_PAID, paid_at: null },
      );

      // 2. A 15.00 credit note is issued against the invoice. Model A: this moves
      //    the DERIVED balance only, so the invoice stays `partially_paid` — which
      //    step 3 depends on to still be accepted as payable.
      credited = '15.00';

      // 3. The payments-only remainder (65.00 - 20.00 = 45.00) is now the WRONG
      //    amount: only 30.00 is still owed (65.00 - 20.00 - 15.00). Paying the
      //    old figure would over-pay the member by the credited 15.00, so it is
      //    refused against the credit-aware ceiling.
      await expect(
        service.recordForInvoice(invoiceId, { amount: 45, payment_method: 'cash' }),
      ).rejects.toThrow(/exceeds the outstanding balance 30\.00/);
      expect(mockPaymentRepo.save).toHaveBeenCalledTimes(1); // only the 20.00 above

      // 4. The correct remainder settles it. This is the assertion the Phase 1
      //    rule failed: payments alone reach only 50.00 of the 65.00 total, so a
      //    payments-only settled test would leave the invoice `partially_paid`
      //    forever with nothing left to pay and the guard refusing any more.
      await service.recordForInvoice(invoiceId, { amount: 30, payment_method: 'cash' });

      expect(paid).toBe('50.00');
      expect(credited).toBe('15.00');
      expect(status).toBe(INVOICE_STATUS.PAID);
      expect(mockInvoiceRepo.update).toHaveBeenLastCalledWith(
        { id: invoiceId, organization_id: orgId },
        { status: INVOICE_STATUS.PAID, paid_at: expect.any(Date) },
      );
    });
  });
});
