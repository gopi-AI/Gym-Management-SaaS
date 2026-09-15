import { IsEnum, IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType, DOCUMENT_TYPE_VALUES } from '../entities/document-type.enum';

/**
 * DTO for document upload metadata.
 * The actual file binary is passed via @UploadedFile() in the controller.
 */
export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DOCUMENT_TYPE_VALUES as unknown as string[])
  document_type!: DocumentType;

  @ApiProperty()
  @IsString()
  file_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mime_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  file_size_bytes?: number;
}