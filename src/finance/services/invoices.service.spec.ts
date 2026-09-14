import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoiceNumberService } from './invoice-number.service';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Payment } from '../entities/payment.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { FINANCE_EVENT_TYPES, INVOICE_STATUS } from '../finance.constants';

/**
 * Behavioral verification of invoice creation and voiding.
 *
 * The properties that matter: totals are computed server-side from the lines
 * (never trusted from the client), the invoice, its lines and its
 * `InvoiceCreated.v1` envelope are written on ONE transaction, and an invoice
 * that already has money against it can never be voided.
 */
describe('InvoicesService', () => {
  let service: InvoicesService;
  let mockInvoiceRepo: Record<string, jest.Mock>;
  let mockItemRepo: Record<string, jest.Mock>;
  let mockPaymentRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, any>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;
  let mockInvoiceNumberService: Record<string, jest.Mock>;

  const orgId = '11111111-1111-4111-8111-111111111111';
  const memberId = '22222222-2222-4222-8222-222222222222';

  const invoiceQueryBuilder = () => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ '?column?': 1 }),
    getRawMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  });

  beforeEach(async () => {
    mockInvoiceRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity: object) => ({
        ...entity,
        id: 'invoice-1',
      })),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(invoiceQueryBuilder),
    };
    mockItemRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entities: object[]) => entities),
      find: jest.fn().mockResolvedValue([]),
    };
    mockPaymentRepo = {
      createQueryBuilder: jest.fn(invoiceQueryBuilder),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: Function) =>
        cb({
          getRepository: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === Invoice) return mockInvoiceRepo;
            if (entity === InvoiceItem) return mockItemRepo;
            if (entity === Payment) return mockPaymentRepo;
            return {};
          }),
        }),
      ),
      createQueryBuilder: jest.fn(invoiceQueryBuilder),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(null),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    };

    mockOutboxService = { saveEventEnvelope: jest.fn().mockResolvedValue({}) };
    mockInvoiceNumberService = {
      nextInvoiceNumber: jest.fn().mockResolvedValue('INV-000042'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getRepositoryToken(Invoice), useValue: mockInvoiceRepo },
        { provide: getRepositoryToken(InvoiceItem), useValue: mockItemRepo },
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: InvoiceNumberService, useValue: mockInvoiceNumberService },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
  });

  describe('create', () => {
    const dto = {
      member_id: memberId,
      line_items: [
        { description: 'Monthly membership', quantity: 1, unit_price: 50 },
        { description: 'Locker', quantity: 2, unit_price: 7.5 },
      ],
    };

    it('computes the totals server-side and issues the invoice as sent', async () => {
      await service.create(dto);

      const invoice = mockInvoiceRepo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(invoice).toMatchObject({
        organization_id: orgId,
        member_id: memberId,
        invoice_number: 'INV-000042',
        subtotal: '65.00',
        tax_amount: '0.00',
        total_amount: '65.00',
        status: INVOICE_STATUS.SENT,
        paid_at: null,
      });

      const items = mockItemRepo.save.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
      expect(items[1]).toMatchObject({
        description: 'Locker',
        quantity: '2.00',
        unit_price: '7.50',
        line_total: '15.00',
      });
    });

    it('holds the invoice as a draft when the caller asks for it', async () => {
      await service.create({ ...dto, issue: false });

      expect(mockInvoiceRepo.create.mock.calls[0][0]).toMatchObject({
        status: INVOICE_STATUS.DRAFT,
      });
    });

    it('emits InvoiceCreated.v1 on the same transaction as the invoice and its lines', async () => {
      await service.create(dto);

      const [eventType, eventVersion, organizationId, payload, correlationId, , manager] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(eventType).toBe(FINANCE_EVENT_TYPES.INVOICE_CREATED);
      expect(eventVersion).toBe('v1');
      expect(organizationId).toBe(orgId);
      expect(payload).toMatchObject({
        invoiceId: 'invoice-1',
        memberId,
        invoiceNumber: 'INV-000042',
        totalAmount: '65.00',
      });
      expect((payload as { lineItems: unknown[] }).lineItems).toHaveLength(2);
      expect(correlationId).toBe('invoice-1');
      expect(manager).toBeDefined();
    });

    it('rejects a member outside the authorized organization before opening a transaction', async () => {
      const missingMemberQuery = invoiceQueryBuilder();
      missingMemberQuery.getRawOne = jest.fn().mockResolvedValue(null);
      mockDataSource.createQueryBuilder = jest.fn(() => missingMemberQuery);

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('voidInvoice', () => {
    it('voids an issued invoice that has nothing collected against it', async () => {
      mockInvoiceRepo.findOne.mockResolvedValue({
        id: 'invoice-1',
        organization_id: orgId,
        total_amount: '65.00',
        status: INVOICE_STATUS.SENT,
      });

      const result = await service.voidInvoice('invoice-1');

      expect(result.status).toBe(INVOICE_STATUS.VOID);
      expect(mockInvoiceRepo.update).toHaveBeenCalledWith(
        { id: 'invoice-1', organization_id: orgId },
        { status: INVOICE_STATUS.VOID },
      );
    });

    it('refuses to void an invoice that already has money against it', async () => {
      mockInvoiceRepo.findOne.mockResolvedValue({
        id: 'invoice-1',
        organization_id: orgId,
        total_amount: '65.00',
        status: INVOICE_STATUS.PARTIALLY_PAID,
      });
      mockPaymentRepo.createQueryBuilder = jest.fn(() => ({
        ...invoiceQueryBuilder(),
        getRawMany: jest.fn().mockResolvedValue([{ invoice_id: 'invoice-1', paid: '20.00' }]),
      }));

      await expect(service.voidInvoice('invoice-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mockInvoiceRepo.update).not.toHaveBeenCalled();
    });

    it('refuses to void a paid invoice', async () => {
      mockInvoiceRepo.findOne.mockResolvedValue({
        id: 'invoice-1',
        organization_id: orgId,
        total_amount: '65.00',
        status: INVOICE_STATUS.PAID,
      });

      await expect(service.voidInvoice('invoice-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is idempotent-hostile on purpose: voiding twice is an error, not a silent no-op', async () => {
      mockInvoiceRepo.findOne.mockResolvedValue({
        id: 'invoice-1',
        organization_id: orgId,
        total_amount: '65.00',
        status: INVOICE_STATUS.VOID,
      });

      await expect(service.voidInvoice('invoice-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
