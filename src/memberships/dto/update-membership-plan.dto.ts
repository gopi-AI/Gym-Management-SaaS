import {
  IsString,
  IsOptional,
  IsNumberString,
  IsIn,
  IsArray,
  IsObject,
  IsBoolean,
  IsInt,
  Matches,
  Min,
} from 'class-validator';

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'AED'];
const SUPPORTED_BILLING_PERIODS = ['monthly', 'quarterly', 'half-yearly', 'yearly', 'one-time'];

export class UpdateMembershipPlanDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  // Same contract as CreateMembershipPlanDto: a decimal string, so the non-negative
  // constraint must be string-compatible (@Min only accepts numbers).
  @IsNumberString()
  @Matches(/^\d*\.?\d+$/, { message: 'price must be a non-negative number' })
  @IsOptional()
  price?: string;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  @IsOptional()
  currency?: string;

  @IsString()
  @IsIn(SUPPORTED_BILLING_PERIODS)
  @IsOptional()
  billing_period?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  duration_days?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  trial_days?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsArray()
  @IsObject({ each: true })
  @IsOptional()
  benefits?: Record<string, unknown>[];
}