import { Body, Controller, Param, ParseUUIDPipe, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { AttachPaymentMethodDto } from '../dto/attach-payment-method.dto';
import { PaymentMethodsService } from '../services/payment-methods.service';

@Controller('v1/members')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Post(':id/payment-methods')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'finance', action: 'record-payment' })
  async attach(
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: AttachPaymentMethodDto,
  ) {
    return this.paymentMethodsService.attachPaymentMethod(memberId, dto);
  }
}