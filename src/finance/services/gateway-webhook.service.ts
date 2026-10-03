import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';

/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class GatewayWebhookService {
  // Stripe is constructed lazily, and only when a key is configured: an empty
  // key makes the SDK throw during DI, which would take down the whole app for
  // a missing *optional* credential. Same rule as `StripePaymentGatewayAdapter`.
  private readonly stripe?: Stripe;
  private readonly secret: string;

  constructor(
    config: ConfigService,
    @InjectRepository(WebhookEvent) private readonly repository: Repository<WebhookEvent>,
  ) {
    this.secret = config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    const key = config.get<string>('STRIPE_SECRET_KEY');
    if (key) this.stripe = new Stripe(key);
  }

  async receive(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
    if (!signature || !this.secret || !this.stripe) throw new BadRequestException('Invalid webhook signature');
    let event: Stripe.Event;
    try { event = this.stripe.webhooks.constructEvent(rawBody, signature, this.secret); }
    catch { throw new BadRequestException('Invalid webhook signature'); }
    const existing = await this.repository.findOne({ where: { provider_event_id: event.id } });
    if (!existing) {
      try {
        await this.repository.save(this.repository.create({
          provider: 'stripe', provider_event_id: event.id, event_type: event.type,
          payload: JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>, status: 'received',
        }));
      } catch (error) {
        // Two concurrent deliveries of the same event can both miss the read above,
        // and the second then lands on UQ_finance_webhook_events_provider_event. The
        // index is the backstop, and the row it collided with is the one this call
        // would have written — so the outcome is the same as the `existing` branch:
        // report received. Anything else is a real failure and must propagate.
        if (!GatewayWebhookService.isUniqueViolation(error)) throw error;
      }
    }
    return { received: true };
  }

  /**
   * A `23505` from the insert, read exactly the way the rest of the module reads
   * it (`PaymentsService.isUniqueViolation`, `RefundsService.isUniqueViolation`).
   *
   * Deliberately a local copy rather than a shared util: the six existing copies
   * are filed as `DEF-10`, a cross-module refactor the owner deferred out of this
   * fix (ruling 4).
   */
  private static isUniqueViolation(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      driverError?: { code?: string };
      message?: string;
    };
    const code = candidate?.driverError?.code ?? candidate?.code;
    return code === UNIQUE_VIOLATION_CODE;
  }
}