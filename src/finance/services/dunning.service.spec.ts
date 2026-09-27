import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { DunningAttempt } from '../entities/dunning-attempt.entity';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { CreditNote } from '../entities/credit-note.entity';
import { DunningService } from './dunning.service';
import { FINANCE_EVENT_TYPES, PAYMENT_RETRY_DEFAULTS } from '../finance.constants';

describe('DunningService', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const invoiceId = '22222222-2222-4222-8222-222222222222';
  let service: DunningService;
  let invoiceRepo: Record<string, any>;
  let paymentRepo: Record<string, any>;
  let creditRepo: Record<string, any>;
  let attempts: Record<string, any>;
  let outbox: { saveEventEnvelope: jest.Mock };
  let manager: { getRepository: jest.Mock };
  let dataSource: { getRepository: jest.Mock; transaction: jest.Mock };
  let invoiceCandidate: any;
  let query: { where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; limit: jest.Mock; getMany: jest.Mock };
  let paidQuery: { select: jest.Mock; addSelect: jest.Mock; where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; groupBy: jest.Mock; getRawOne: jest.Mock };
  let creditQuery: { select: jest.Mock; addSelect: jest.Mock; where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; groupBy: jest.Mock; getRawOne: jest.Mock };
  let failedPaymentQuery: { where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; addOrderBy: jest.Mock; getOne: jest.Mock };
  let paymentQueryCount: number;

  beforeEach(async () => {
    invoiceCandidate = {
      id: invoiceId, organization_id: organizationId, member_id: 'member-1',
      due_date: new Date('2026-09-01T00:00:00.000Z'), total_amount: '100.00', status: 'sent',
    };
    query = {
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([invoiceCandidate]),
    };
    invoiceRepo = {
      createQueryBuilder: jest.fn(() => query),
      findOne: jest.fn().mockResolvedValue(invoiceCandidate),
    };
    paidQuery = {
      select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ amount: '20.00' }),
    };
    creditQuery = {
      select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ amount: '10.00' }),
    };
    failedPaymentQuery = {
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), addOrderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    paymentQueryCount = 0;
    paymentRepo = {
      createQueryBuilder: jest.fn(() => paymentQueryCount++ === 0 ? paidQuery : failedPaymentQuery),
    };
    creditRepo = { createQueryBuilder: jest.fn(() => creditQuery) };
    attempts = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((value: any) => value),
      save: jest.fn().mockImplementation(async (value: any) => value),
    };
    outbox = { saveEventEnvelope: jest.fn().mockResolvedValue({}) };
    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Invoice) return invoiceRepo;
        if (entity === Payment) {
          return paymentRepo;
        }
        if (entity === CreditNote) return creditRepo;
        if (entity === DunningAttempt) return attempts;
        return {};
      }),
    };
    dataSource = {
      getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => query) })),
      transaction: jest.fn((callback: (tx: typeof manager) => unknown) => callback(manager)),
    };
    const module = await Test.createTestingModule({
      providers: [
        DunningService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: OutboxService, useValue: outbox },
      ],
    }).compile();
    service = module.get(DunningService);
  });

  it('emits one overdue event with outstanding after succeeded payments and credits, transactionally', async () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    await expect(service.processOverdueInvoices({ now, limit: 8 })).resolves.toEqual({ scanned: 1, overdueEvents: 1, escalated: 0 });
    expect(query.where).toHaveBeenCalledWith('invoice.status IN (:...statuses)', { statuses: ['sent', 'partially_paid'] });
    expect(query.andWhere).toHaveBeenCalledWith('invoice.due_date < :now', { now });
    expect(invoiceRepo.findOne).toHaveBeenCalledWith({
      where: { id: invoiceId, organization_id: organizationId }, lock: { mode: 'pessimistic_write' },
    });
    expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
      FINANCE_EVENT_TYPES.INVOICE_OVERDUE, 'v1', organizationId,
      expect.objectContaining({ invoiceId, memberId: 'member-1', amountOutstanding: '70.00', daysOverdue: 23 }),
      invoiceId, undefined, manager,
    );
    expect(attempts.save).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId, invoice_id: invoiceId, channel: 'internal',
      event_type: FINANCE_EVENT_TYPES.INVOICE_OVERDUE, outcome: 'event_enqueued',
    }));
  });

  it('is idempotent on repeated runs and does not send a second overdue event', async () => {
    attempts.findOne.mockResolvedValueOnce({ id: 'already-overdue' });
    await expect(service.processOverdueInvoices({ now: new Date('2026-09-24T00:00:00Z') }))
      .resolves.toMatchObject({ overdueEvents: 0, escalated: 0 });
    expect(outbox.saveEventEnvelope).not.toHaveBeenCalled();
    expect(attempts.save).not.toHaveBeenCalled();
  });

  it('does not escalate before payment retry max attempts', async () => {
    paymentQueryCount = 0;
    failedPaymentQuery.getOne.mockResolvedValue({ retry_count: PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS - 1 });
    await service.processOverdueInvoices({ now: new Date('2026-09-24T00:00:00Z') });
    expect(outbox.saveEventEnvelope).toHaveBeenCalledTimes(1);
    expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
      FINANCE_EVENT_TYPES.INVOICE_OVERDUE, expect.any(String), expect.any(String), expect.any(Object),
      expect.any(String), undefined, manager,
    );
  });

  it('escalates a terminal exhausted retry once, and never escalates a paid/credited invoice', async () => {
    paymentQueryCount = 0;
    failedPaymentQuery.getOne.mockResolvedValue({ retry_count: PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS });
    await service.processOverdueInvoices({ now: new Date('2026-09-24T00:00:00Z') });
    expect(outbox.saveEventEnvelope).toHaveBeenCalledTimes(2);
    expect(outbox.saveEventEnvelope).toHaveBeenNthCalledWith(
      2, FINANCE_EVENT_TYPES.DUNNING_ESCALATED, 'v1', organizationId,
      expect.objectContaining({ invoiceId, attemptCount: PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS }),
      invoiceId, undefined, manager,
    );
    expect(attempts.save).toHaveBeenCalledWith(expect.objectContaining({
      event_type: FINANCE_EVENT_TYPES.DUNNING_ESCALATED, attempt_number: 2,
    }));

    paidQuery.getRawOne.mockResolvedValueOnce({ amount: '100.00' });
    outbox.saveEventEnvelope.mockClear();
    attempts.findOne.mockReset().mockResolvedValue(null);
    paymentQueryCount = 0;
    await service.processOverdueInvoices({ now: new Date('2026-09-24T00:00:00Z') });
    expect(outbox.saveEventEnvelope).not.toHaveBeenCalled();
  });

  it('guards scan results and locked reads with organization_id', async () => {
    await service.processOverdueInvoices({ now: new Date('2026-09-24T00:00:00Z') });
    expect(query.where).toHaveBeenCalledWith('invoice.status IN (:...statuses)', { statuses: ['sent', 'partially_paid'] });
    expect(invoiceRepo.findOne.mock.calls[0][0].where).toEqual({ id: invoiceId, organization_id: organizationId });
    expect(manager.getRepository).toHaveBeenCalledWith(Invoice);
  });
});