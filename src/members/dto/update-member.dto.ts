import { IsString, IsOptional, IsEmail, IsBoolean, Length, IsDateString } from 'class-validator';

export class UpdateMemberDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  first_name?: string;

  @IsString()
  @IsOptional()
  @Length(1, 255)
  last_name?: string;

  @IsString()
  @IsOptional()
  @Length(1, 255)
  middle_name?: string;

  @IsString()
  @IsOptional()
  @Length(1, 255)
  preferred_name?: string;

  @IsDateString()
  @IsOptional()
  date_of_birth?: string;

  @IsString()
  @IsOptional()
  @Length(1, 50)
  gender?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address_line1?: string;

  @IsString()
  @IsOptional()
  address_line2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  postal_code?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}