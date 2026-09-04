import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateTenantSettingsDto {
  @IsUUID()
  organization_id!: string;

  @IsString()
  time_zone!: string;

  @IsString()
  locale!: string;

  @IsString()
  currency!: string;
}