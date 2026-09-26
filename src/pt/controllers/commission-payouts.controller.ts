import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { CreateCommissionPayoutDto } from '../dto/create-commission-payout.dto';
import { CommissionPayoutsService } from '../services/commission-payouts.service';

@Controller('v1/pt/commission-payouts')
export class CommissionPayoutsController {
  constructor(private readonly payouts: CommissionPayoutsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'pt', action: 'payout' })
  create(@Body() dto: CreateCommissionPayoutDto) {
    return this.payouts.create(dto);
  }

  @Post(':id/process')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'pt', action: 'payout' })
  process(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.payouts.process(id);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'pt', action: 'read' })
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.payouts.findOne(id);
  }
}