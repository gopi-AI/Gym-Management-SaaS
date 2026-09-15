import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
  IsDateString,
  MaxLength,
  Min,
  Max,
  Length,
} from 'class-validator';

/**
 * Input for creating a `PTPackage` (§12 Q4).
 *
 * `price` is the NET (tax-exclusive) price — tax handling is Phase 3 finance
 * scope, so there are no tax fields.
 *
 * `currency` is optional on input: when omitted, the service stores the
 * organization's currency explicitly on the row (it is never inferred at read
 * time).
 */
export class CreatePtPackageDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(1)
  session_count!: number;

  @IsNumber()
  @Min(0)
  price!: number;

  /** ISO-4217, 3 characters. Defaults to the organization's currency. */
  @IsString()
  @Length(3, 3)
  @IsOptional()
  currency?: string;

  /** Package-level default trainer commission percentage (§12 Q2). */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  commission_percent?: number;

  @IsDateString()
  @IsOptional()
  valid_from?: string;

  @IsDateString()
  @IsOptional()
  valid_to?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}