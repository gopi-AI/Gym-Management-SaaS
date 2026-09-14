import {
  IsUUID,
  IsOptional,
  IsDateString,
  IsString,
  Length,
} from 'class-validator';

export class CreateMembershipDto {
  @IsUUID()
  member_id!: string;

  @IsUUID()
  plan_id!: string;

  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @IsDateString()
  @IsOptional()
  start_date?: string;

  @IsDateString()
  @IsOptional()
  end_date?: string;
}