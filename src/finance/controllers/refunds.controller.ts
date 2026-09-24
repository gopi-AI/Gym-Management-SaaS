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
import { RefundsService } from '../services/refunds.service';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { QueryRefundDto } from '../dto/query-refund.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Refund API (`docs/phase3-scoping-plan.md` §2).
 *
 * Issuing is addressed by PAYMENT (`POST /v1/payments/{id}/refunds`) because a
 * refund always belongs to a payment — that attachment is what makes
 * `SUM(refunds.amount) <= payment.amount` checkable. The refund list is its own
 * resource for the refunds report, mirroring `PaymentsController`.
 *
 * `POST` is guarded by `finance:refund`, NOT `finance:record-payment`: sending
 * money back out is a materially different authority from taking it in, so a
 * front-desk role that may record a payment does not automatically gain the
 * ability to refund one. `finance:refund` is provisioned by migration
 * 1788965263257 (§12.3).
 */
@Controller('v1')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get('refunds')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findAll(@Query() query: QueryRefundDto) {
    return this.refundsService.findAll(query);
  }

  @Get('refunds/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.refundsService.findOne(id);
  }

  @Post('payments/:id/refunds')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'finance', action: 'refund' })
  async createForPayment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @Body() dto: CreateRefundDto,
  ) {
    return this.refundsService.create(paymentId, dto);
  }
}
