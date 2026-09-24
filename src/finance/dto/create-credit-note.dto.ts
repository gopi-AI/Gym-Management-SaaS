import { IsString, IsOptional, IsDateString, IsNumber, Min, Length } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Issue a credit note against an invoice (`POST /v1/invoices/{id}/credit-notes`).
 *
 * **The caller supplies ONE figure — the gross credit — and the server computes
 * the net/tax split** (§15 Q5's tax-reversal ruling: the credit note carries its
 * own `net_amount` / `tax_amount` / `gross_amount`, computed at creation time).
 *
 * The split is derived pro-rata from the invoice's OWN applied tax ratio
 * (`invoice.tax_amount / invoice.total_amount`), so it needs no tax rate lookup
 * and cannot disagree with what was actually charged:
 *
 *   - an invoice with no tax (`tax_amount = 0.00`, every Phase 1 invoice) credits
 *     `net = amount`, `tax = 0.00`, so Phase 1 behaviour is unchanged;
 *   - crediting a taxed invoice in full reproduces the invoice's tax exactly,
 *     which is the exact inverse of what was applied;
 *   - a partial credit reverses tax in the same proportion as the invoice.
 *
 * Tax is rounded ONCE and net is derived from it (`net = amount - tax`), so
 * `net + tax = amount` exactly — the same discipline as `computeLineTax`, and it
 * is what the `CHK_finance_credit_notes_amounts_balance` constraint asserts.
 */
export class CreateCreditNoteDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /** Why the invoice is being reduced. Required — an unreasoned credit is unauditable. */
  @IsString()
  @Length(1, 500)
  reason!: string;

  /** Defaults to now when omitted, matching `issued_date`. */
  @IsDateString()
  @IsOptional()
  issued_date?: string;
}
