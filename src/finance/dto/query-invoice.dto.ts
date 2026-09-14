import { IsOptional, IsInt, Min, IsString, IsUUID, IsDateString, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Invoice search query (page + limit, matching `QueryMembershipDto`).
 *
 * `outstanding_only=true` is what the payments screen uses to show a member's
 * unpaid invoices (draft/sent/partially_paid, i.e. anything not paid or void).
 */
export class QueryInvoiceDto {
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
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  member_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  membership_id?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  outstanding_only?: boolean;
}
