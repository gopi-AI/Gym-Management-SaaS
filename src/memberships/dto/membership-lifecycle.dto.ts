import { IsString, IsOptional, Length } from 'class-validator';

export class MembershipLifecycleDto {
  @IsString()
  @IsOptional()
  @Length(1, 500)
  reason?: string;
}