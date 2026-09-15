import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { ConsentType, CONSENT_TYPE_VALUES } from '../entities/consent-type.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RevokeConsentDto {
  @ApiProperty({ enum: ConsentType })
  @IsEnum(CONSENT_TYPE_VALUES as unknown as string[])
  consent_type!: ConsentType;

  @ApiProperty()
  @IsDateString()
  revoked_at!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  revocation_reason?: string;
}