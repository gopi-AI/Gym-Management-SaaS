import { Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { GatewayWebhookService } from '../services/gateway-webhook.service';
import { Public } from '../../shared/auth/public.decorator';
import { ThrottleWebhook } from '../../shared/throttling/throttle.decorators';

type RawRequest = Request & { rawBody?: Buffer };

@Controller('v1/webhooks')
export class GatewayWebhookController {
  constructor(private readonly service: GatewayWebhookService) {}

  @Post('payment-gateway')
  @Public()
  @ThrottleWebhook()
  receive(@Req() request: RawRequest, @Headers('stripe-signature') signature?: string) {
    return this.service.receive(request.rawBody ?? Buffer.alloc(0), signature);
  }
}