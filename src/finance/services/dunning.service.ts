import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CreditNote } from '../entities/credit-note.entity';
import { DunningAttempt } from '../entities/dunning-attempt.entity';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { PAYMENT_RETRY_DEFAULTS, PAYMENT_STATUS, toMoney } from '../finance.constants';
import { FINANCE_EVENT_TYPES, FINANCE_EVENT_VERSION } from '../finance.constants';
import { OutboxService } from '../../shared/outbox/outbox.service';

export interface DunningRunResult {
  scanned: number;
  overdueEvents: number;
  escalated: number;
}

/** Worker-only, event-driven follow-up for overdue invoices. */
@Injectable()
export class DunningService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outboxService: OutboxService,
  ) {}

  async processOverdueInvoices(options: { limit?: number; now?: Date } = {}): Promise<DunningRunResult> {
    const now = options.now ?? new Date();
    const candidates = await this.dataSource.getRepository(Invoice).createQueryBuilder('invoice')
      .where('invoice.status IN (:...statuses)', { statuses: ['sent', 'partially_paid'] })
      .andWhere('invoice.due_date < :now', { now })
      .orderBy('invoice.due_date', 'ASC')
      .limit(options.limit ?? 50)
      .getMany();
    const result: DunningRunResult = { scanned: candidates.length, overdueEvents: 0, escalated: 0 };
    for (const candidate of candidates) {
      const processed = await this.dataSource.transaction((manager) =>
        this.processOne(manager, candidate.id, candidate.organization_id, now),
      );
      result.overdueEvents += processed.overdue ? 1 : 0;
      result.escalated += processed.escalated ? 1 : 0;
    }
    return result;
  }

  private async processOne(
    manager: EntityManager,
    invoiceId: string,
    organizationId: string,
    now: Date,
  ): Promise<{ overdue: boolean; escalated: boolean }> {
    const invoiceRepo = manager.getRepository(Invoice);
    const invoice = await invoiceRepo.findOne({
      where: { id: invoiceId, organization_id: organizationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice || !['sent', 'partially_paid'].includes(invoice.status) || invoice.due_date >= now) {
      return { overdue: false, escalated: false };
    }

    const paidRows = await manager.getRepository(Payment).createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'amount')
      .where('payment.organization_id = :organizationId', { organizationId })
      .andWhere('payment.invoice_id = :invoiceId', { invoiceId })
      .andWhere('payment.status = :status', { status: PAYMENT_STATUS.SUCCEEDED })
      .getRawOne<{ amount: string }>();
    const creditRows = await manager.getRepository(CreditNote).createQueryBuilder('creditNote')
      .select('COALESCE(SUM(creditNote.gross_amount), 0)', 'amount')
      .where('creditNote.organization_id = :organizationId', { organizationId })
      .andWhere('creditNote.invoice_id = :invoiceId', { invoiceId })
      .andWhere('creditNote.status = :status', { status: 'issued' })
      .getRawOne<{ amount: string }>();
    const outstanding = toMoney(Math.max(
      0,
      Number(invoice.total_amount) - Number(paidRows?.amount ?? 0) - Number(creditRows?.amount ?? 0),
    ));
    if (Number(outstanding) <= 0) return { overdue: false, escalated: false };

    const attemptRepo = manager.getRepository(DunningAttempt);
    const existingOverdue = await attemptRepo.findOne({
      where: { organization_id: organizationId, invoice_id: invoiceId, event_type: FINANCE_EVENT_TYPES.INVOICE_OVERDUE },
    });
    let overdue = false;
    if (!existingOverdue) {
      const daysOverdue = Math.max(1, Math.floor((now.getTime() - invoice.due_date.getTime()) / 86_400_000));
      const payload = {
        invoiceId,
        memberId: invoice.member_id,
        organizationId,
        amountOutstanding: outstanding,
        dueDate: invoice.due_date.toISOString(),
        daysOverdue,
      };
      await this.outboxService.saveEventEnvelope(
        FINANCE_EVENT_TYPES.INVOICE_OVERDUE,
        FINANCE_EVENT_VERSION,
        organizationId,
        payload,
        invoiceId,
        undefined,
        manager,
      );
      await attemptRepo.save(attemptRepo.create({
        organization_id: organizationId,
        invoice_id: invoiceId,
        channel: 'internal',
        attempt_number: 1,
        event_type: FINANCE_EVENT_TYPES.INVOICE_OVERDUE,
        scheduled_at: now,
        sent_at: now,
        outcome: 'event_enqueued',
      }));
      overdue = true;
    }

    const latestFailedPayment = await manager.getRepository(Payment).createQueryBuilder('payment')
      .where('payment.organization_id = :organizationId', { organizationId })
      .andWhere('payment.invoice_id = :invoiceId', { invoiceId })
      .andWhere('payment.status = :status', { status: PAYMENT_STATUS.FAILED })
      .orderBy('payment.last_attempt_at', 'DESC', 'NULLS LAST')
      .addOrderBy('payment.created_at', 'DESC')
      .getOne();
    let escalated = false;
    if (latestFailedPayment && latestFailedPayment.retry_count >= PAYMENT_RETRY_DEFAULTS.MAX_ATTEMPTS) {
      const existingEscalation = await attemptRepo.findOne({
        where: { organization_id: organizationId, invoice_id: invoiceId, event_type: FINANCE_EVENT_TYPES.DUNNING_ESCALATED },
      });
      if (!existingEscalation) {
        const escalatedAt = now.toISOString();
        await this.outboxService.saveEventEnvelope(
          FINANCE_EVENT_TYPES.DUNNING_ESCALATED,
          FINANCE_EVENT_VERSION,
          organizationId,
          { invoiceId, organizationId, attemptCount: latestFailedPayment.retry_count, escalatedAt },
          invoiceId,
          undefined,
          manager,
        );
        await attemptRepo.save(attemptRepo.create({
          organization_id: organizationId,
          invoice_id: invoiceId,
          channel: 'internal',
          attempt_number: 2,
          event_type: FINANCE_EVENT_TYPES.DUNNING_ESCALATED,
          scheduled_at: now,
          sent_at: now,
          outcome: 'event_enqueued',
        }));
        escalated = true;
      }
    }
    return { overdue, escalated };
  }
}