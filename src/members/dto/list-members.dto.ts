import { IsOptional, IsInt, Min, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class ListMembersDto {
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

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  branch_id?: string;

  @IsString()
  @IsOptional()
  @IsIn(['created_at', 'first_name', 'last_name', 'local_id'])
  sort_by?: string;

  @IsString()
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_dir?: string;
}