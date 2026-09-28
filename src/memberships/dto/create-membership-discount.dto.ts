import { IsDateString, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMembershipDiscountDto {
  @IsIn(['fixed', 'percentage'])
  discount_type!: 'fixed' | 'percentage';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000000000)
  amount!: number;

  @IsDateString()
  @IsOptional()
  starts_at?: string;

  @IsDateString()
  @IsOptional()
  ends_at?: string;
}