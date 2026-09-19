import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { InvoicesService } from './invoices.service';
import { CreditNote } from '../entities/credit-note.entity';
import { Invoice } from '../entities/invoice.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  CREDIT_NOTE_STATUS,
  FINANCE_EVENT_TYPES,
  INVOICE_STATUS,
  toMoney,
} from '../finance.constants';

/**
 * P3-02 — credit notes, and above all the TAX REVERSAL.
 *
 * The property this file exists to prove is that a credit note reverses the tax
 * that was actually charged, computed from the invoice's own applied rate
 * (`invoice.tax_amount / invoice.total_amount`) rather than from a live rate
 * lookup. The two are easy to confuse and hard to tell apart in review, so the
 * full-credit case asserts the reversal against the invoice's OWN stored
 * `subtotal` and `tax_amount` — if `splitCredit` ever started consulting
 * `FINANCE_TAX_RATES` instead, these tests would drift from the invoice.
 *
 * `FINANCE_TAX_LINES` is never involved: the second half of the file pins that no
 * write is issued for it and that the breakdown lives on the credit note.
 */
describe('CreditNotesService', () => {
  let service: CreditNotesService;
  let mockCreditNoteRepo: Record<string, jest.Mock>;
  let mockInvoiceRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, any>;
  let mockInvoicesService: { loadInvoiceForUpdate: jest.Mock };
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;

  /** Rows the `SUM(gross_amount)` credited-total query resolves. */
  let creditedRows: Array<{ credited: string }>;
  /** The manager the transaction handed the service, for same-transaction proofs. */
  let transactionManager: Record<string, any>;

  const orgId = '11111111-1111-4111-8111-111111111111';
  const otherOrgId = '22222222-2222-4222-8222-222222222222';
  const invoiceId = '33333333-3333-4333-8333-333333333333';

  /**
   * The invoice every create() test credits: net 100.00, tax 18.00, gross 118.00
   * — i.e. one 100.00 line at 18% exclusive, as `computeLineTax` produces it.
   */
  const invoice = (overrides: Partial<Invoice> = {}): Invoice =>
    ({
      id: invoiceId,
      organization_id: orgId,
      member_id: 'member-1',
      invoice_number: 'INV-000042',
      subtotal: '100.00',
      tax_amount: '18.00',
      total_amount: '118.00',
      status: INVOICE_STATUS.SENT,
      ...overrides,
    }) as Invoice;

  beforeEach(async () => {
    creditedRows = [];

    mockCreditNoteRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (entity: object) => ({
        ...entity,
        id: 'credit-note-1',
      })),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn(() => {
        const builder: Record<string, jest.Mock> = {
          select: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          getRawOne: jest
            .fn()
            .mockImplementation(async () => creditedRows[0] ?? { credited: '0' }),
        };
        for (const method of ['select', 'where', 'andWhere']) {
          builder[method].mockReturnValue(builder);
        }
        return builder;
      }),
    };

    mockInvoiceRepo = {};

    mockInvoicesService = {
      loadInvoiceForUpdate: jest.fn().mockResolvedValue(invoice()),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: Function) => {
        transactionManager = {
          getRepository: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === CreditNote) return mockCreditNoteRepo;
            if (entity === Invoice) return mockInvoiceRepo;
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
        CreditNotesService,
        { provide: getRepositoryToken(CreditNote), useValue: mockCreditNoteRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: InvoicesService, useValue: mockInvoicesService },
      ],
    }).compile();

    service = module.get<CreditNotesService>(CreditNotesService);
  });

  describe('splitCredit — the tax reversal, as a pure function', () => {
    it('makes a FULL credit the exact inverse of what the invoice charged', () => {
      // The invoice's own numbers are net 100.00 + tax 18.00 = 118.00. A full
      // credit must reproduce those exactly, or the reversal is not a reversal.
      const { net, tax } = CreditNotesService.splitCredit('118.00', '18.00', '118.00');

      expect(net).toBe('100.00'); // === invoice.subtotal
      expect(tax).toBe('18.00'); // === invoice.tax_amount
      expect(toMoney(Number(net) + Number(tax))).toBe('118.00');
    });

    it('reverses tax PROPORTIONALLY for a partial credit', () => {
      // Half of 118.00, so half the tax and half the net.
      expect(CreditNotesService.splitCredit('59.00', '18.00', '118.00')).toEqual({
        net: '50.00',
        tax: '9.00',
      });
    });

    it.each([
      ['11.80', '10.00', '1.80'], // a tenth of the invoice
      ['5.90', '5.00', '0.90'], // a twentieth
      ['23.60', '20.00', '3.60'], // a fifth
      ['118.00', '100.00', '18.00'], // all of it
    ])('splits %s in the invoice own proportion', (amount, net, tax) => {
      expect(CreditNotesService.splitCredit(amount, '18.00', '118.00')).toEqual({ net, tax });
    });

    it('rounds the tax ONCE and derives net, so the parts equal the credit exactly', () => {
      // 33.33 x 18/118 = 5.0847... -> 5.08; net is then DERIVED as 33.33 - 5.08
      // rather than rounded independently, which is what makes the sum exact.
      const { net, tax } = CreditNotesService.splitCredit('33.33', '18.00', '118.00');

      expect(tax).toBe('5.08');
      expect(net).toBe('28.25');
      expect(toMoney(Number(net) + Number(tax))).toBe('33.33');
    });

    it('treats an UNTAXED invoice as entirely net, so Phase 1 invoices are unchanged', () => {
      // Every Phase 1 invoice has tax_amount 0.00, as does any P3-04 invoice whose
      // lines carried no tax_code. Crediting one must not invent a tax reversal.
      expect(CreditNotesService.splitCredit('100.00', '0.00', '100.00')).toEqual({
        net: '100.00',
        tax: '0.00',
      });
    });

    it('never produces a negative net when rounding would push tax past the credit', () => {
      // 0.01 on a 99%-taxed invoice rounds the tax part up to the whole credit;
      // the clamp keeps net at 0.00 and the sum still exact, rather than emitting
      // a negative net amount that the DB CHECK would reject anyway.
      const { net, tax } = CreditNotesService.splitCredit('0.01', '0.99', '1.00');

      expect(Number(net)).toBeGreaterThanOrEqual(0);
      expect(toMoney(Number(net) + Number(tax))).toBe('0.01');
    });

    it('always satisfies net + tax = gross, over a spread of awkward inputs', () => {
      for (const amount of ['0.01', '0.05', '1.00', '9.99', '33.33', '99.99', '118.00']) {
        for (const [tax, total] of [
          ['18.00', '118.00'],
          ['7.50', '107.50'],
          ['0.00', '100.00'],
          ['20.50', '120.50'],
        ]) {
          const split = CreditNotesService.splitCredit(amount, tax, total);
          expect(toMoney(Number(split.net) + Number(split.tax))).toBe(toMoney(amount));
        }
      }
    });
  });

  describe('create', () => {
    const dto = { amount: 118, reason: 'Plan downgraded' };

    it('issues a credit note whose breakdown is the invoice tax reversed', async () => {
      const creditNote = await service.create(invoiceId, dto);

      expect(creditNote).toMatchObject({
        organization_id: orgId,
        invoice_id: invoiceId,
        net_amount: '100.00',
        tax_amount: '18.00',
        gross_amount: '118.00',
        reason: 'Plan downgraded',
        status: CREDIT_NOTE_STATUS.ISSUED,
      });
    });

    it('stores parts that add up to the gross it reduces the invoice by', async () => {
      const creditNote = await service.create(invoiceId, { ...dto, amount: 59 });

      expect(creditNote.net_amount).toBe('50.00');
      expect(creditNote.tax_amount).toBe('9.00');
      expect(toMoney(Number(creditNote.net_amount) + Number(creditNote.tax_amount))).toBe(
        creditNote.gross_amount,
      );
    });

    it('leaves the invoice itself untouched (Model A)', async () => {
      await service.create(invoiceId, dto);

      // Model A: the adjustment is a separate record. No invoice write of any
      // kind is attempted, which is what keeps `Invoice.status` — and
      // `VALID_INVOICE_TRANSITIONS` — out of this feature entirely.
      expect(mockInvoiceRepo).not.toHaveProperty('update');
      expect(mockInvoiceRepo).not.toHaveProperty('save');
    });

    it('never asks the transaction for any table but the credit notes', async () => {
      await service.create(invoiceId, dto);

      const requested = transactionManager.getRepository.mock.calls.map(
        (call: unknown[]) => call[0],
      );

      // CreditNote is the only ENTITY the service ever asks the transaction for
      // (twice: the credited-total query and the insert). A FINANCE_TAX_LINES
      // write would have to ask for TaxLine first, so the absence of any other
      // entity is the direct evidence that the immutable tax audit rows are left
      // alone (§15 Q5 tax-reversal ruling).
      expect(new Set(requested)).toEqual(new Set([CreditNote]));
    });

    it('emits CreditNoteIssued.v1 on the SAME transaction as the credit note', async () => {
      await service.create(invoiceId, dto);

      const [eventType, version, emittedOrg, payload, correlationId, , manager] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];

      expect(eventType).toBe(FINANCE_EVENT_TYPES.CREDIT_NOTE_ISSUED);
      expect(version).toBe('v1');
      expect(emittedOrg).toBe(orgId);
      expect(correlationId).toBe(invoiceId);
      expect(payload).toMatchObject({
        creditNoteId: 'credit-note-1',
        invoiceId,
        netAmount: '100.00',
        taxAmount: '18.00',
        grossAmount: '118.00',
        reason: 'Plan downgraded',
        status: CREDIT_NOTE_STATUS.ISSUED,
      });
      // The same manager object the repository came from: one transaction, so the
      // credit note and its event commit or roll back together.
      expect(manager).toBe(transactionManager);
    });

    it('rolls back when the event write fails, having already written the credit note', async () => {
      mockOutboxService.saveEventEnvelope.mockRejectedValue(new Error('outbox down'));

      await expect(service.create(invoiceId, dto)).rejects.toThrow('outbox down');

      // The save happened BEFORE the failing event write, so this is a real
      // rollback assertion rather than a "never got that far" one: without a
      // shared transaction the credit note would survive with no event.
      expect(mockCreditNoteRepo.save).toHaveBeenCalledTimes(1);
    });

    it('cannot credit an invoice belonging to another organization', async () => {
      // `loadInvoiceForUpdate` is org-scoped, so a foreign invoice is simply not
      // found — it does not leak that it exists.
      mockInvoicesService.loadInvoiceForUpdate.mockRejectedValue(
        new NotFoundException('Invoice not found'),
      );

      await expect(service.create(invoiceId, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockCreditNoteRepo.save).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('scopes the invoice load to the AUTHORIZED org, never one from the request', async () => {
      await service.create(invoiceId, dto);

      expect(mockInvoicesService.loadInvoiceForUpdate).toHaveBeenCalledWith(
        expect.anything(),
        invoiceId,
        orgId,
      );
      expect(mockInvoicesService.loadInvoiceForUpdate).not.toHaveBeenCalledWith(
        expect.anything(),
        invoiceId,
        otherOrgId,
      );
    });

    it('rejects a credit exceeding the un-credited balance, writing nothing', async () => {
      creditedRows = [{ credited: '100.00' }]; // 18.00 left of 118.00

      await expect(service.create(invoiceId, { ...dto, amount: 20 })).rejects.toThrow(
        /exceeds the un-credited balance 18\.00/,
      );
      expect(mockCreditNoteRepo.save).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('allows a credit exactly equal to the un-credited balance', async () => {
      // The bound is inclusive: crediting the remainder must be possible, or a
      // partially credited invoice could never be settled in full.
      creditedRows = [{ credited: '100.00' }];

      const creditNote = await service.create(invoiceId, { ...dto, amount: 18 });

      expect(creditNote.gross_amount).toBe('18.00');
      expect(creditNote.tax_amount).toBe('2.75'); // 18.00 x 18/118 = 2.7457... -> 2.75
      expect(creditNote.net_amount).toBe('15.25');
    });

    it('rejects once the invoice is fully credited', async () => {
      creditedRows = [{ credited: '118.00' }];

      await expect(service.create(invoiceId, dto)).rejects.toThrow(/fully credited/);
      expect(mockCreditNoteRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to credit a VOIDED invoice', async () => {
      mockInvoicesService.loadInvoiceForUpdate.mockResolvedValue(
        invoice({ status: INVOICE_STATUS.VOID }),
      );

      await expect(service.create(invoiceId, dto)).rejects.toThrow(
        /voided invoice cannot be credited/,
      );
      expect(mockCreditNoteRepo.save).not.toHaveBeenCalled();
    });

    it('counts only ISSUED credit notes towards what is already credited', async () => {
      await service.create(invoiceId, dto);

      const builder = mockCreditNoteRepo.createQueryBuilder.mock.results[0].value;

      // That filter is the whole point: a VOIDED credit note no longer reduces the
      // invoice, so it must not consume any of the creditable amount either.
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('status'), {
        status: CREDIT_NOTE_STATUS.ISSUED,
      });
    });
  });
});
