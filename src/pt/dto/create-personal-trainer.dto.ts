import {
  IsString,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsDateString,
  MaxLength,
} from 'class-validator';

/** Input for creating a `PersonalTrainer` (§1 field list). */
export class CreatePersonalTrainerDto {
  /** Branch the trainer belongs to — validated against the authorized org. */
  @IsUUID()
  branch_id!: string;

  /** Optional login for the trainer (nullable per §1). */
  @IsUUID()
  @IsOptional()
  user_id?: string;

  @IsString()
  @MaxLength(255)
  first_name!: string;

  @IsString()
  @MaxLength(255)
  last_name!: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  specialty?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  certification?: string;

  @IsDateString()
  @IsOptional()
  hire_date?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}