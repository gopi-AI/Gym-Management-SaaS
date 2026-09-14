import {
  IsString,
  IsOptional,
  IsNumberString,
  IsNotEmpty,
  IsIn,
  IsArray,
  IsObject,
  Length,
  Matches,
  Min,
  IsInt,
} from 'class-validator';

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'AED'];
const SUPPORTED_BILLING_PERIODS = ['monthly', 'quarterly', 'half-yearly', 'yearly', 'one-time'];

export class CreateMembershipPlanDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  // price is a decimal string end-to-end (UI sends String(price), the entity maps
  // it to decimal(10,2) and returns it as a string), so it must be validated as a
  // string. @Min() only accepts numbers and could never pass on this field; the
  // non-negative constraint is enforced with a string pattern instead.
  @IsNumberString()
  @Matches(/^\d*\.?\d+$/, { message: 'price must be a non-negative number' })
  price!: string;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @IsString()
  @IsIn(SUPPORTED_BILLING_PERIODS)
  billing_period!: string;

  @IsInt()
  @Min(1)
  duration_days!: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  trial_days?: number;

  @IsArray()
  @IsObject({ each: true })
  @IsOptional()
  benefits?: Record<string, unknown>[];
}