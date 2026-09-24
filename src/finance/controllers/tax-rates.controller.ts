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
import { TaxRatesService } from '../services/tax-rates.service';
import { CreateTaxRateDto } from '../dto/create-tax-rate.dto';
import { QueryTaxRateDto } from '../dto/query-tax-rate.dto';
import { TaxRate } from '../entities/tax-rate.entity';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Tax rate API (`docs/phase3-scoping-plan.md` §4).
 *
 * The organization is never taken from the request body/query: every route derives
 * it from the authorized tenant context (`TenantContextService`), so a caller
 * cannot configure or read another tenant's tax rates.
 *
 * `POST` is guarded by `finance:admin`, NOT `finance:create`. §4: "changing tax
 * configuration is a compliance-sensitive action" — a front-desk role may hold
 * `finance:create` to raise invoices without being able to change the rates those
 * invoices are taxed at. `finance:admin` is provisioned by migration
 * 1788965263254 (§12.3).
 */
@Controller('v1/tax-rates')
export class TaxRatesController {
  constructor(private readonly taxRatesService: TaxRatesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findAll(@Query() query: QueryTaxRateDto) {
    return this.taxRatesService.findAll(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<TaxRate> {
    return this.taxRatesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'finance', action: 'admin' })
  async create(@Body() dto: CreateTaxRateDto): Promise<TaxRate> {
    return this.taxRatesService.create(dto);
  }
}
