import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PaymentsService } from '../services/payments.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { QueryPaymentDto } from '../dto/query-payment.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Payment API (`docs/api-plan.md` §Finance).
 *
 * Recording a payment is addressed by INVOICE
 * (`POST /v1/invoices/{id}/payments`) because a payment always belongs to an
 * invoice; the payment list is its own resource for the payments report.
 */
@Controller('v1')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('payments')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findAll(@Query() query: QueryPaymentDto) {
    return this.paymentsService.findAll(query);
  }

  @Get('payments/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.paymentsService.findOne(id);
  }

  @Post('invoices/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'finance', action: 'record-payment' })
  async recordForInvoice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) invoiceId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.recordForInvoice(invoiceId, dto);
  }
}
