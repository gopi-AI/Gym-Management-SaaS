import {
  IsString,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsUUID,
  IsEnum,
} from 'class-validator';
import { ConsentType, CONSENT_TYPE_VALUES } from '../entities/consent-type.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GrantConsentDto {
  @ApiProperty({ enum: ConsentType })
  @IsEnum(CONSENT_TYPE_VALUES as unknown as string[])
  consent_type!: ConsentType;

  @ApiProperty()
  @IsBoolean()
  is_given!: boolean;

  @ApiProperty()
  @IsDateString()
  given_at!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expires_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  document_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  version?: number;
}