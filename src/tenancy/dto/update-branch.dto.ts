import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class UpdateBranchDto {
  @IsUUID()
  @IsOptional()
  organization_id?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}