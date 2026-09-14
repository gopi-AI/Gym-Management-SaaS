import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { InvoicesService } from './invoices.service';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { FINANCE_EVENT_TYPES, INVOICE_STATUS, PAYMENT_STATUS } from '../finance.constants';

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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepo },
        { provide: getRepositoryToken(Invoice), useValue: mockInvoiceRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: InvoicesService, useValue: mockInvoicesService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
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
});
