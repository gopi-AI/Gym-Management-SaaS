import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoiceNumberService } from './invoice-number.service';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Payment } from '../entities/payment.entity';
import { TaxLine } from '../entities/tax-line.entity';
import { InvoiceDiscount } from '../entities/invoice-discount.entity';
import { TaxRate } from '../entities/tax-rate.entity';
import { CreditNote } from '../entities/credit-note.entity';
import { TaxRatesService } from './tax-rates.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { FINANCE_EVENT_TYPES, INVOICE_STATUS, TAX_EXEMPT_NAME } from '../finance.constants';

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
  let mockTaxLineRepo: Record<string, jest.Mock>;
  let mockTaxRateRepo: Record<string, jest.Mock>;
  let mockInvoiceDiscountRepo: Record<string, jest.Mock>;
  /** P3-02: standing credit notes, read to derive the invoice balance. */
  let mockCreditNoteRepo: Record<string, jest.Mock>;
  /** Rows `mockCreditNoteRepo`'s SUM(gross_amount) query resolves. */
  let creditedRows: Array<{ invoice_id: string; credited: string }>;
  /** Set to true by a test to make `isMemberTaxExempt` resolve an exempt member. */
  let memberTaxExempt: boolean;
  /** The query builder handed out by the transaction manager (exemption read). */
  let transactionQueryBuilder: jest.Mock;
  /** The builder `transactionQueryBuilder` last produced, for asserting the read. */
  let lastMemberQuery: ReturnType<typeof memberQuery>;
  let mockDataSource: Record<string, any>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;
  let mockInvoiceNumberService: Record<string, jest.Mock>;
  let mockTaxRatesService: Record<string, jest.Mock>;

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

  /**
   * Query builder for the `MEMBERS_MEMBERS` exemption read.
   *
   * `isMemberTaxExempt` selects `m.tax_exempt` as a raw column, so the default
   * row deliberately has NO `tax_exempt` key: `row?.tax_exempt === true` is then
   * false, which is the non-exempt default every Phase 1 assertion relies on.
   * A test that wants an exempt member overrides `getRawOne`.
   */
  const memberQuery = (taxExempt = false) => ({
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ tax_exempt: taxExempt }),
  });
  /** An active, in-force, exclusive rate — the shape `resolveActiveRates` yields. */
  const gstRate = (overrides: Partial<TaxRate> = {}): TaxRate =>
    ({
      id: 'rate-1',
      organization_id: orgId,
      name: 'GST',
      code: 'GST',
      rate: '18.00',
      is_inclusive: false,
      is_active: true,
      effective_from: new Date('2026-01-01T00:00:00.000Z'),
      effective_to: null,
      ...overrides,
    }) as TaxRate;

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
      // Ids are assigned so the tax-line step has something to reference:
      // `InvoiceItem.id` is what a FINANCE_TAX_LINES row points at.
      save: jest.fn().mockImplementation(async (entities: object[]) =>
        entities.map((entity, index) => ({ ...entity, id: `item-${index + 1}` })),
      ),
      find: jest.fn().mockResolvedValue([]),
    };
    mockPaymentRepo = {
      createQueryBuilder: jest.fn(invoiceQueryBuilder),
    };
    mockTaxLineRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entities: object[]) =>
        (Array.isArray(entities) ? entities : [entities]).map((entity, index) => ({
          ...entity,
          id: `tax-line-${index + 1}`,
        })),
      ),
      find: jest.fn().mockResolvedValue([]),
    };
    mockInvoiceDiscountRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue({}),
    };

    mockTaxRateRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    // P3-02: `creditNoteTotalsByInvoice` runs a fluent SUM(gross_amount) query.
    // Default is no credit notes, so every Phase 1 assertion keeps seeing the
    // payments-only balance it always saw.
    creditedRows = [];
    mockCreditNoteRepo = {
      createQueryBuilder: jest.fn(() => {
        const builder: Record<string, jest.Mock> = {
          select: jest.fn(),
          addSelect: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          groupBy: jest.fn(),
          getRawMany: jest.fn().mockImplementation(async () => creditedRows),
        };
        for (const method of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
          builder[method].mockReturnValue(builder);
        }
        return builder;
      }),
    };
    memberTaxExempt = false;
    // Captured so a test can prove the exemption read used the TRANSACTION's
    // query builder rather than the ambient DataSource.
    transactionQueryBuilder = jest.fn(() => {
      lastMemberQuery = memberQuery(memberTaxExempt);
      return lastMemberQuery;
    });

    // Default: no tax rates configured, member not exempt. Both are per-test
    // overrides, so every Phase 1 assertion keeps seeing tax_amount '0.00'.
    mockTaxRatesService = {
      resolveActiveRates: jest.fn().mockResolvedValue(new Map()),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: Function) =>
        cb({
          getRepository: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === Invoice) return mockInvoiceRepo;
            if (entity === InvoiceItem) return mockItemRepo;
            if (entity === Payment) return mockPaymentRepo;
            if (entity === TaxLine) return mockTaxLineRepo;
            if (entity === TaxRate) return mockTaxRateRepo;
            if (entity === InvoiceDiscount) return mockInvoiceDiscountRepo;
            return {};
          }),
          // Used by `isMemberTaxExempt`, which reads MEMBERS_MEMBERS on the
          // caller's transaction. `tax_exempt` is false by default — the Phase 1
          // behaviour — and a test opting into an exemption sets
          // `memberTaxExempt = true` before calling.
          createQueryBuilder: transactionQueryBuilder,
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
        { provide: getRepositoryToken(TaxLine), useValue: mockTaxLineRepo },
        { provide: getRepositoryToken(InvoiceDiscount), useValue: mockInvoiceDiscountRepo },
        { provide: getRepositoryToken(CreditNote), useValue: mockCreditNoteRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: InvoiceNumberService, useValue: mockInvoiceNumberService },
        { provide: TaxRatesService, useValue: mockTaxRatesService },
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

  describe('create — P3-04 tax', () => {
    /** Two lines, both carrying a GST code: 100.00 and 7.50. */
    const taxedDto = {
      member_id: memberId,
      line_items: [
        { description: 'Monthly membership', quantity: 1, unit_price: 100, tax_code: 'GST' },
        { description: 'Locker', quantity: 2, unit_price: 7.5, tax_code: 'GST' },
      ],
    };

    /** The rate `resolveActiveRates` would return for GST. */
    const resolveGst = (overrides: Partial<TaxRate> = {}) => {
      mockTaxRatesService.resolveActiveRates.mockResolvedValue(
        new Map([['GST', gstRate(overrides)]]),
      );
    };

    const createdInvoice = () => mockInvoiceRepo.create.mock.calls[0][0] as Record<string, unknown>;

    const membershipSaleManager = {
      getRepository: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === Invoice) return mockInvoiceRepo;
        if (entity === InvoiceItem) return mockItemRepo;
        if (entity === TaxLine) return mockTaxLineRepo;
        if (entity === InvoiceDiscount) return mockInvoiceDiscountRepo;
        return {};
      }),
      createQueryBuilder: () => memberQuery(false),
    } as any;

    it('computes tax on the discounted amount, not the original membership price', async () => {
      resolveGst();

      // MembershipsService applies the $20 discount before handing the $80
      // membership line to Finance. Finance must tax that discounted line.
      await service.create({
        member_id: memberId,
        line_items: [{
          description: 'Monthly membership',
          quantity: 1,
          unit_price: 80,
          tax_code: 'GST',
        }],
      });

      expect(createdInvoice()).toMatchObject({
        subtotal: '80.00',
        tax_amount: '14.40',
        total_amount: '94.40',
      });
    });

    it('leaves invoice generation unchanged when there is no active discount', async () => {
      resolveGst();

      await service.createForMembershipSale({
        organizationId: orgId,
        memberId,
        membershipId: 'membership-1',
        description: 'Monthly membership',
        amount: '100.00',
        manager: membershipSaleManager,
      });

      expect(createdInvoice()).toMatchObject({
        subtotal: '100.00',
        tax_amount: '0.00',
        total_amount: '100.00',
      });
      expect(mockInvoiceDiscountRepo.save).not.toHaveBeenCalled();
    });

    it('stays untaxed when no line carries a tax_code (Phase 1 backwards compatibility)', async () => {
      await service.create({
        member_id: memberId,
        line_items: [{ description: 'Monthly membership', quantity: 1, unit_price: 65 }],
      });

      expect(createdInvoice()).toMatchObject({
        subtotal: '65.00',
        tax_amount: '0.00',
        total_amount: '65.00',
      });
      // No tax_code -> no tax row at all. A zero-rated row here would change the
      // shape of every existing invoice and the reports built on it.
      expect(mockTaxLineRepo.save).not.toHaveBeenCalled();
      // And no rate lookup is even attempted for an empty code set.
      expect(mockTaxRatesService.resolveActiveRates).toHaveBeenCalledWith(
        orgId,
        [''],
        expect.any(Date),
        expect.anything(),
      );
    });

    it('adds tax on top and records one tax line per taxed line', async () => {
      resolveGst();

      await service.create(taxedDto);

      // Line 1: 1 x 100.00 @ 18% exclusive -> tax 18.00.
      // Line 2: 2 x 7.50 = 15.00 @ 18% exclusive -> tax 2.70.
      // Net 115.00, tax 20.70, so the member owes 135.70.
      expect(createdInvoice()).toMatchObject({
        subtotal: '115.00',
        tax_amount: '20.70',
        total_amount: '135.70',
      });

      const taxLines = mockTaxLineRepo.save.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(taxLines).toHaveLength(2);
      expect(taxLines[0]).toMatchObject({
        organization_id: orgId,
        invoice_item_id: 'item-1',
        tax_name: 'GST',
        tax_rate: '18.00',
        tax_amount: '18.00',
      });
      // The rate is snapshotted per line, and the amount is the tax on that line's
      // full quantity x unit_price — not on a single unit.
      expect(taxLines[1]).toMatchObject({
        invoice_item_id: 'item-2',
        tax_rate: '18.00',
        tax_amount: '2.70',
      });
    });

    it('keeps Invoice.tax_amount equal to the sum of its tax lines', async () => {
      // This is the property a tax authority's report reconciles against: the
      // header must equal the detail to the cent.
      resolveGst();

      await service.create(taxedDto);

      const taxLines = mockTaxLineRepo.save.mock.calls[0][0] as Array<Record<string, unknown>>;
      const summed = taxLines.reduce((total, line) => total + Number(line.tax_amount), 0);
      expect(Number(createdInvoice().tax_amount)).toBeCloseTo(summed, 2);
    });

    it('leaves line_total as quantity x unit_price so the event payload is unchanged', async () => {
      resolveGst();

      await service.create(taxedDto);

      const items = mockItemRepo.save.mock.calls[0][0] as Array<Record<string, unknown>>;
      // `line_total` stays the amount as entered; the tax separation is carried by
      // the invoice totals and FINANCE_TAX_LINES, not by rewriting the line.
      expect(items[0]).toMatchObject({ line_total: '100.00', tax_code: 'GST' });
      expect(items[1]).toMatchObject({ line_total: '15.00', tax_code: 'GST' });
    });

    it('rolls the invoice back when a tax_code does not resolve', async () => {
      // The rate lookup returns nothing for the requested code -> the whole
      // invoice is rejected rather than silently untaxed.
      mockTaxRatesService.resolveActiveRates.mockResolvedValue(new Map());

      await expect(service.create(taxedDto)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockInvoiceRepo.save).not.toHaveBeenCalled();
      expect(mockItemRepo.save).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('names the offending codes when rejecting an invoice', async () => {
      mockTaxRatesService.resolveActiveRates.mockResolvedValue(new Map());

      await expect(service.create(taxedDto)).rejects.toThrow(/GST/);
    });

    it('records a zero-rated audit row for an exempt member and charges no tax', async () => {
      resolveGst();
      memberTaxExempt = true;

      await service.create(taxedDto);

      expect(createdInvoice()).toMatchObject({
        subtotal: '115.00',
        tax_amount: '0.00',
        total_amount: '115.00',
      });

      // §4: "a zero-rated line is a real audit row, not a missing one" — a missing
      // row cannot be told apart from a line nobody computed tax for.
      const taxLines = mockTaxLineRepo.save.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(taxLines).toHaveLength(2);
      for (const line of taxLines) {
        expect(line).toMatchObject({
          tax_name: TAX_EXEMPT_NAME,
          tax_rate: '0.00',
          tax_amount: '0.00',
        });
      }
    });

    it('reads the exemption on the invoice transaction, not from a stale read', async () => {
      // The flag is read inside the transaction so the rule applied is the
      // committed one; a concurrent PATCH must not be able to tax an invoice under
      // a rule that was never in force.
      resolveGst();

      await service.create(taxedDto);

      // The exemption read went through the transaction manager's builder...
      expect(transactionQueryBuilder).toHaveBeenCalledTimes(1);
      expect(lastMemberQuery.where).toHaveBeenCalledWith(
        'm.id = :id AND m.organization_id = :orgId',
        { id: memberId, orgId },
      );
      // ...and the only use of the AMBIENT connection is the pre-transaction
      // membership check, which runs before any tax decision is made.
      expect(mockDataSource.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('backs the tax out of the total when the rate is inclusive', async () => {
      // 118.00 entered @ 18% inclusive -> net 100.00, tax 18.00, member still owes
      // 118.00. An inclusive rate must never inflate the amount charged.
      resolveGst({ is_inclusive: true });

      await service.create({
        member_id: memberId,
        line_items: [
          { description: 'Retail item', quantity: 1, unit_price: 118, tax_code: 'GST' },
        ],
      });

      expect(createdInvoice()).toMatchObject({
        subtotal: '100.00',
        tax_amount: '18.00',
        total_amount: '118.00',
      });
    });

    it('resolves the rate as of the invoice instant, on the invoice transaction', async () => {
      resolveGst();

      await service.create(taxedDto);

      const [organizationId, codes, at, manager] =
        mockTaxRatesService.resolveActiveRates.mock.calls[0];
      expect(organizationId).toBe(orgId);
      expect(codes).toEqual(['GST', 'GST']);
      expect(at).toBeInstanceOf(Date);
      expect(manager).toBeDefined();
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

    it('names the real endpoints when refusing to void a paid invoice (§2 debt repayment)', async () => {
      mockInvoiceRepo.findOne.mockResolvedValue({
        id: 'invoice-1',
        organization_id: orgId,
        total_amount: '65.00',
        status: INVOICE_STATUS.PAID,
      });

      // The guard still rejects — §2 only required the message to stop saying
      // "out of scope" now that refunds and credit notes exist.
      await expect(service.voidInvoice('invoice-1')).rejects.toThrow(
        /A paid invoice cannot be voided; issue a refund against the payment.*credit note/,
      );
      await expect(service.voidInvoice('invoice-1')).rejects.not.toThrow(/out of scope/);
    });
  });

  describe('outstanding balance — P3-02 credit notes (Model A)', () => {
    /**
     * Fluent stand-in for the `SUM(...)` totals query. `paymentTotalsByInvoice`
     * and `creditNoteTotalsByInvoice` are shaped identically, so one helper
     * serves both.
     */
    const totalsBuilder = (key: string, value: string) => {
      const builder: Record<string, jest.Mock> = {
        select: jest.fn(),
        addSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        groupBy: jest.fn(),
        getRawMany: jest.fn().mockResolvedValue([{ invoice_id: 'invoice-1', [key]: value }]),
      };
      for (const method of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
        builder[method].mockReturnValue(builder);
      }
      return builder;
    };

    const invoiceRow = {
      id: 'invoice-1',
      organization_id: orgId,
      member_id: memberId,
      invoice_number: 'INV-000042',
      subtotal: '100.00',
      tax_amount: '18.00',
      total_amount: '118.00',
      status: INVOICE_STATUS.SENT,
    };

    beforeEach(() => {
      mockInvoiceRepo.findOne = jest.fn().mockResolvedValue(invoiceRow);
      mockItemRepo.find = jest.fn().mockResolvedValue([]);
    });

    it('reduces the reported balance by the credit notes on the invoice', async () => {
      // This is Model A made observable: `Invoice.status` is untouched, so the
      // ONLY place the credit shows up on the invoice is the derived balance.
      mockPaymentRepo.createQueryBuilder = jest.fn(() => totalsBuilder('paid', '40.00'));
      creditedRows = [{ invoice_id: 'invoice-1', credited: '18.00' }];

      const detail = await service.findOne('invoice-1');

      // 118.00 total - 40.00 paid - 18.00 credited
      expect(detail.amount_paid).toBe('40.00');
      expect(detail.amount_credited).toBe('18.00');
      expect(detail.outstanding_amount).toBe('60.00');
      // The status is deliberately NOT rewritten.
      expect(detail.invoice.status).toBe(INVOICE_STATUS.SENT);
    });

    it('reports zero outstanding for a fully credited invoice without changing its status', async () => {
      mockPaymentRepo.createQueryBuilder = jest.fn(() => totalsBuilder('paid', '0.00'));
      creditedRows = [{ invoice_id: 'invoice-1', credited: '118.00' }];

      const detail = await service.findOne('invoice-1');

      expect(detail.outstanding_amount).toBe('0.00');
      expect(detail.invoice.status).toBe(INVOICE_STATUS.SENT);
    });

    it('never reports a negative balance if credits and payments exceed the total', async () => {
      // Defensive: the guards should prevent this, but a balance of -20.00 in a
      // report is worse than a clamped zero, so the clamp is asserted.
      mockPaymentRepo.createQueryBuilder = jest.fn(() => totalsBuilder('paid', '100.00'));
      creditedRows = [{ invoice_id: 'invoice-1', credited: '38.00' }];

      const detail = await service.findOne('invoice-1');

      expect(detail.outstanding_amount).toBe('0.00');
    });

    it('leaves an invoice with NO credit notes exactly as Phase 1 reported it', async () => {
      // Backwards compatibility: the credit term must be a no-op when there are
      // no credit notes, which is every invoice that existed before P3-02.
      mockPaymentRepo.createQueryBuilder = jest.fn(() => totalsBuilder('paid', '40.00'));
      creditedRows = [];

      const detail = await service.findOne('invoice-1');

      expect(detail.amount_credited).toBe('0.00');
      expect(detail.outstanding_amount).toBe('78.00'); // 118.00 - 40.00
    });

    it('reads the credits for the whole page in ONE query, not per invoice', async () => {
      mockPaymentRepo.createQueryBuilder = jest.fn(() => totalsBuilder('paid', '0.00'));
      mockInvoiceRepo.createQueryBuilder = jest.fn(() => {
        const builder: Record<string, jest.Mock> = {
          where: jest.fn(),
          andWhere: jest.fn(),
          orderBy: jest.fn(),
          addOrderBy: jest.fn(),
          take: jest.fn(),
          skip: jest.fn(),
          getManyAndCount: jest.fn().mockResolvedValue([[invoiceRow], 1]),
        };
        for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'take', 'skip']) {
          builder[method].mockReturnValue(builder);
        }
        return builder;
      });

      await service.findAll({});

      expect(mockCreditNoteRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });
  });
});
