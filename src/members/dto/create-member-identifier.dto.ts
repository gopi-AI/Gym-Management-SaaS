import { IsString, IsBoolean, IsOptional, Length } from 'class-validator';

export class CreateMemberIdentifierDto {
  @IsString()
  @Length(1, 50)
  identifier_type!: string;

  @IsString()
  @Length(1, 255)
  identifier_value!: string;

  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;
}