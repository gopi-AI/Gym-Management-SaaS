import { IsOptional, IsInt, Min, IsUUID, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { CREDIT_NOTE_STATUS } from '../finance.constants';

/**
 * Credit-note search query (`GET /v1/credit-notes`): page/limit plus org-scoped
 * filters.
 *
 * `invoice_id` IS supported here, unlike on refunds: a credit note attaches to an
 * invoice (§2), so the column exists and a "what has been credited against this
 * invoice" lookup is a direct index hit rather than a join through payments.
 */
export class QueryCreditNoteDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  invoice_id?: string;

  /** One of `CREDIT_NOTE_STATUS` — `issued` or `voided`. */
  @IsOptional()
  @IsIn(Object.values(CREDIT_NOTE_STATUS))
  status?: string;
}
