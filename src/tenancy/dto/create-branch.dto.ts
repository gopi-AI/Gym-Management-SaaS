import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class CreateBranchDto {
  @IsUUID()
  organization_id!: string;

  @IsString()
  name!: string;

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