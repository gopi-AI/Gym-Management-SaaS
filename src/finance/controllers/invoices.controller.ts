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
import { InvoicesService } from '../services/invoices.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { Invoice } from '../entities/invoice.entity';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Invoice API (`docs/api-plan.md` §Finance).
 *
 * The organization is never taken from the request body/query: every route
 * derives it from the authorized tenant context (`TenantContextService`), so a
 * caller cannot invoice across tenants.
 */
@Controller('v1/invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findAll(@Query() query: QueryInvoiceDto) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.invoicesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'finance', action: 'create' })
  async create(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(dto);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'update' })
  async voidInvoice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Invoice> {
    return this.invoicesService.voidInvoice(id);
  }
}
