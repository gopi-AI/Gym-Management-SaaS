import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsNumber,
  Min,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

/** A single billable line on an invoice. */
export class InvoiceLineItemDto {
  @IsString()
  @Length(1, 500)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_price!: number;

  /** Unused in this pass — tax handling is out of scope. */
  @IsString()
  @IsOptional()
  @Length(1, 50)
  tax_code?: string;
}

/**
 * Explicit invoice creation (`POST /v1/invoices`, documented in
 * `docs/api-plan.md`).
 *
 * `issue` controls whether the invoice is created already `sent` (issued and
 * therefore payable) or held as a `draft`. It defaults to `true` because this
 * Phase 1 API has no separate "send to customer" step, so a draft would be an
 * unreachable, unusable state; pass `issue: false` to deliberately hold an
 * invoice as a draft.
 */
export class CreateInvoiceDto {
  @IsUUID()
  member_id!: string;

  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @IsUUID()
  @IsOptional()
  membership_id?: string;

  @IsDateString()
  @IsOptional()
  due_date?: string;

  @IsBoolean()
  @IsOptional()
  issue?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  line_items!: InvoiceLineItemDto[];
}
