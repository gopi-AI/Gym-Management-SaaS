import { IsString, IsOptional, IsBoolean, IsNumberString, IsDateString, IsNotEmpty, Length, Matches } from 'class-validator';

/**
 * Create a tax rate (`POST /v1/tax-rates`, admin — `finance:admin`).
 *
 * `rate` is a PERCENTAGE as a decimal string (`"18.00"` = 18%), matching
 * `FINANCE_TAX_RATES.rate` (NUMERIC(5,2)) and `TAX_RATE_UNIT`. It is validated as
 * a string rather than a number for the same reason `CreateMembershipPlanDto.price`
 * is: the value is a decimal end-to-end (the entity maps it to `numeric` and returns
 * a string), and `@Min()` only accepts numbers, so it could never pass here.
 *
 * The `< 100` bound on an inclusive rate mirrors the database CHECK constraint
 * added by migration 1788965263255. It is duplicated on purpose: the constraint
 * protects the data, the validator returns a 400 instead of a 500.
 */
export class CreateTaxRateDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  /**
   * Machine key referenced by `InvoiceItem.tax_code`. Upper-cased by the service
   * before storage so `gst` and `GST` cannot become two rates for one tax.
   */
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, digits, underscore and hyphen',
  })
  code!: string;

  @IsNumberString()
  @Matches(/^\d*(\.\d+)?$/, { message: 'rate must be a non-negative number' })
  rate!: string;

  /** `true` when the tax is already contained in the line amount. */
  @IsBoolean()
  @IsOptional()
  is_inclusive?: boolean;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsDateString()
  @IsOptional()
  effective_from?: string;

  @IsDateString()
  @IsOptional()
  effective_to?: string;
}
