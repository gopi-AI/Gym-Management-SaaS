import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { PAYMENT_STATUS } from '../finance.constants';
import { WEBHOOK_LOCK_DURATION_MS } from '../../shared/workers/worker-config';
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

  /**
   * Attempt ceiling before a row is parked as `'dead_lettered'` (DEF-05).
   * Owner ruling #9 (2026-10-02): 5, not the outbox's 10.
   */
  static readonly MAX_ATTEMPTS = 5;

  /**
   * Claim a batch and process it (DEF-05).
   *
   * Two statements sit in one CTE. `parked` moves exhausted rows aside; `claimed`
   * takes rows that are new (`'received'`), retryable (`'failed'`), or stranded in
   * `'processing'` by a claimant that died — under the attempt ceiling, and whose
   * lease is absent or expired. That last case is the DEF-05 recovery: a row is
   * reclaimed once its lease lapses instead of sitting in `'processing'` forever.
   * `FOR UPDATE SKIP LOCKED` keeps two concurrent callers off the same rows.
   *
   * `attempts` is incremented HERE, on the claim, not when a failure is recorded:
   * a claimant that dies never reaches `markFailed`, so an increment there would
   * be lost and a crash-looping row would never reach the ceiling. The two sets
   * are disjoint — `parked` needs `attempts >= $2`, `claimed` needs
   * `attempts < $2` — so the two CTEs never contend for a row.
   */
  async processBatch(limit: number): Promise<number> {
    // `manager.query` returns [rows, affectedCount] for an UPDATE … RETURNING, not
    // the rows alone — iterating the tuple directly yields the rows array and the
    // count, whose `.id` is undefined. Destructure the rows out.
    //
    // The lease window is computed in SQL ($3 is the lease in milliseconds, not a
    // pre-computed cutoff): an app-side `Date.now()` is the application's clock,
    // while `locked_at` is written by the database's `now()`. Mixing the two makes
    // the lease depend on clock skew between the app host and the DB — a fast app
    // clock would consider live leases expired.
    const [events] = await this.dataSource.transaction(async (manager) => manager.query(
      `WITH parked AS (
         UPDATE "FINANCE_WEBHOOK_EVENTS"
            SET status = 'dead_lettered',
                locked_at = NULL,
                error_message = COALESCE(error_message, 'abandoned by claimant')
          WHERE status IN ('processing','failed') AND attempts >= $2
            AND (locked_at IS NULL OR locked_at < now() - ($3::int * interval '1 millisecond'))
          RETURNING id
       ), claimed AS (
         SELECT id FROM "FINANCE_WEBHOOK_EVENTS"
          WHERE status IN ('received','failed','processing') AND attempts < $2
            AND (locked_at IS NULL OR locked_at < now() - ($3::int * interval '1 millisecond'))
          ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE "FINANCE_WEBHOOK_EVENTS" e
          SET status = 'processing', locked_at = now(), attempts = e.attempts + 1
         FROM claimed WHERE e.id = claimed.id RETURNING e.*`,
      [limit, WebhookEventProcessor.MAX_ATTEMPTS, WEBHOOK_LOCK_DURATION_MS]));
    for (const event of events as WebhookEvent[]) {
      try { await this.processOne(event.id); }
      catch (error) { await this.markFailed(event.id, event.provider_event_id, error); }
    }
    return events.length;
  }

  /**
   * Record a failure and release the lease so a later poll can retry.
   *
   * Deliberately not part of the attempt's transaction — that one has already
   * rolled back, and the record has to survive the rollback. `attempts` is NOT
   * touched here: the claim owns it (see `processBatch`). A row that has reached
   * the ceiling is parked by the next claim's `parked` sweep.
   */
  private async markFailed(id: string, providerEventId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Webhook event ${providerEventId} failed: ${message}`);
    await this.dataSource.getRepository(WebhookEvent).update(id, {
      status: 'failed', error_message: message, locked_at: null,
    });
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
      event.status = 'processed'; event.processed_at = new Date(); event.locked_at = null; await manager.getRepository(WebhookEvent).save(event);
    });
  }
}