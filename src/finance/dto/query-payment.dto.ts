import { IsOptional, IsInt, Min, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

/** Payment search query (page + limit). */
export class QueryPaymentDto {
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

  @IsOptional()
  @IsUUID()
  member_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
