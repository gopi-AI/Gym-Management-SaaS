import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { PAYMENT_STATUS } from '../finance.constants';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { PaymentAttemptOutcome } from './payment-gateway.port';

@Injectable()
export class WebhookEventProcessor {
  private readonly logger = new Logger(WebhookEventProcessor.name);
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  async processBatch(limit: number): Promise<number> {
    const events = await this.dataSource.transaction(async (manager) => manager.query(
      `WITH claimed AS (SELECT id FROM "FINANCE_WEBHOOK_EVENTS" WHERE status = 'received' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT $1)
       UPDATE "FINANCE_WEBHOOK_EVENTS" e SET status = 'processing' FROM claimed WHERE e.id = claimed.id RETURNING e.*`, [limit]));
    for (const event of events as WebhookEvent[]) {
      try { await this.processOne(event.id); }
      catch (error) { this.logger.error(`Webhook event ${event.provider_event_id} failed: ${error instanceof Error ? error.message : String(error)}`); await this.dataSource.getRepository(WebhookEvent).update(event.id, { status: 'failed', error_message: error instanceof Error ? error.message : String(error) }); }
    }
    return events.length;
  }

  private async processOne(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await manager.getRepository(WebhookEvent).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.status === 'processed') return;
      const stripeEvent = event.payload as unknown as Stripe.Event;
      const object = stripeEvent.data?.object as unknown as { id?: string; status?: string; metadata?: Record<string, unknown> };
      const paymentId = typeof object.metadata?.paymentId === 'string' ? object.metadata.paymentId : undefined;
      const refundId = typeof object.metadata?.refundId === 'string' ? object.metadata.refundId : undefined;
      if (paymentId) {
        const outcome: PaymentAttemptOutcome = {
          succeeded: stripeEvent.type.includes('succeeded'),
          transactionId: object.id,
          gatewayReference: object.id,
          gatewayStatus: object.status,
          gatewayResponse: JSON.stringify(object),
          failureReason: object.status,
        };
        await this.payments.applyGatewayOutcome(manager, paymentId, outcome);
      }
      if (refundId) {
        await this.refunds.applyGatewayOutcome(manager, refundId, {
          succeeded: stripeEvent.type === 'charge.refunded',
          gatewayStatus: object.status,
        });
      }
      event.status = 'processed'; event.processed_at = new Date(); await manager.getRepository(WebhookEvent).save(event);
    });
  }
}