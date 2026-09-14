import {
  IsOptional,
  IsDateString,
  IsUUID,
} from 'class-validator';

export class UpdateMembershipDto {
  @IsUUID()
  @IsOptional()
  plan_id?: string;

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