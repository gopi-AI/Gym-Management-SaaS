import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Payment } from '../entities/payment.entity';
import { Refund } from '../entities/refund.entity';
import { PAYMENT_STATUS } from '../finance.constants';
import { WEBHOOK_LOCK_DURATION_MS } from '../../shared/workers/worker-config';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { PaymentAttemptOutcome } from './payment-gateway.port';

/**
 * DEF-06: the event types that change state, and the outcome each one applies.
 *
 * This replaces a `type.includes('succeeded')` substring test. That test was
 * broader than the processor's intent — it also matched `charge.succeeded` and
 * `invoice.payment_succeeded`, neither of which this processor should act on, and
 * it would have matched any future type with the word in it. Only these three
 * types change state today; everything else is recorded and left alone.
 */
const HANDLED_EVENT_TYPES: Record<string, { kind: 'payment' | 'refund'; succeeded: boolean }> = {
  'payment_intent.succeeded': { kind: 'payment', succeeded: true },
  'payment_intent.payment_failed': { kind: 'payment', succeeded: false },
  'charge.refunded': { kind: 'refund', succeeded: true },
};

/**
 * DEF-06: a reference is usable only if it can address a `uuid` column. Anything
 * else is treated as NO reference rather than handed to the database, where it
 * would raise `invalid input syntax for type uuid` — failing the event, retrying
 * it to the ceiling and parking it over what is really a malformed payload.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function referenceId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

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
      const paymentId = referenceId(object.metadata?.paymentId);
      const refundId = referenceId(object.metadata?.refundId);
      const handler = HANDLED_EVENT_TYPES[stripeEvent.type];
      const who = `Webhook event ${event.provider_event_id} (${stripeEvent.type})`;

      if (!handler) {
        this.logger.log(`${who} is not a handled event type — recorded with no state change`);
      } else if (handler.kind === 'payment' && paymentId) {
        const outcome: PaymentAttemptOutcome = {
          succeeded: handler.succeeded,
          transactionId: object.id,
          gatewayReference: object.id,
          gatewayStatus: object.status,
          gatewayResponse: JSON.stringify(object),
          failureReason: object.status,
        };
        await this.payments.applyGatewayOutcome(manager, paymentId, outcome);
        // DEF-04: attribute the row to a tenant. The receive path has no
        // authorized tenant context by design (it is `@Public()`, authenticated by
        // signature alone), so the org has to come from the row this event refers
        // to, read here where the transaction already holds it.
        const payment = await manager.getRepository(Payment).findOne({ where: { id: paymentId } });
        if (payment) event.organization_id = payment.organization_id;
      } else if (handler.kind === 'refund' && refundId) {
        await this.refunds.applyGatewayOutcome(manager, refundId, {
          succeeded: handler.succeeded,
          gatewayStatus: object.status,
        });
        const refund = await manager.getRepository(Refund).findOne({ where: { id: refundId } });
        if (refund) event.organization_id = refund.organization_id;
      } else {
        // A handled type that cannot be applied: no reference at all, or a
        // reference that is not a UUID (see `referenceId`). Neither is a failure —
        // the event is recorded, consumes no retry, and stays unattributed.
        this.logger.log(`${who} names no usable ${handler.kind} reference (absent or not a UUID) — recorded with no state change`);
      }

      event.status = 'processed'; event.processed_at = new Date(); event.locked_at = null; await manager.getRepository(WebhookEvent).save(event);
    });
  }
}