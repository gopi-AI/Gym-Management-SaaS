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
import { CreditNotesService } from '../services/credit-notes.service';
import { CreateCreditNoteDto } from '../dto/create-credit-note.dto';
import { QueryCreditNoteDto } from '../dto/query-credit-note.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Credit-note API (`docs/phase3-scoping-plan.md` §2).
 *
 * Issuing is addressed by INVOICE (`POST /v1/invoices/{id}/credit-notes`) because
 * a credit note always belongs to an invoice — the invoice is what is reduced.
 *
 * `POST` is guarded by `finance:credit-note`, which is distinct from both
 * `finance:refund` (no money moves) and `finance:update`. Reducing what a member
 * owes is not the same authority as editing an invoice, and keeping the three
 * separate is what lets a role be granted one without the others. Provisioned by
 * migration 1788965263257 (§12.3).
 */
@Controller('v1')
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Get('credit-notes')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findAll(@Query() query: QueryCreditNoteDto) {
    return this.creditNotesService.findAll(query);
  }

  @Get('credit-notes/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.creditNotesService.findOne(id);
  }

  @Post('invoices/:id/credit-notes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'finance', action: 'credit-note' })
  async createForInvoice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) invoiceId: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.creditNotesService.create(invoiceId, dto);
  }
}
