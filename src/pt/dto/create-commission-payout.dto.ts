import { IsDateString, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateCommissionPayoutDto {
  @IsDateString()
  period_start!: string;

  @IsDateString()
  period_end!: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;
}