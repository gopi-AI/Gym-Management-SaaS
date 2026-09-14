import { IsOptional, IsInt, Min, IsString, Length, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryMembershipDto {
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
  @Length(1, 50)
  status?: string;

  @IsOptional()
  @IsUUID()
  plan_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  member_id?: string;
}