import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';

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
      await this.repository.save(this.repository.create({
        provider: 'stripe', provider_event_id: event.id, event_type: event.type,
        payload: JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>, status: 'received',
      }));
    }
    return { received: true };
  }
}