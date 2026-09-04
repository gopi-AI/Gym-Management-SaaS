import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  name!: string;

  @IsString()
  timezone!: string;

  @IsString()
  locale!: string;

  @IsString()
  currency!: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}