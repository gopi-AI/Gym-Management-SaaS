import { IsString, IsOptional, IsBoolean, IsUUID, IsNotEmpty, Length } from 'class-validator';

export class CreateBranchDto {
  @IsUUID()
  organization_id!: string;

  @IsString()
  name!: string;

  /**
   * Required (DEF-03): `TENANCY_BRANCHES.address` is `varchar(500) NOT NULL`, so an
   * omitted value reached Postgres as NULL and surfaced as a 500. Validating here
   * makes it a 400 from the global ValidationPipe instead. The bound matches the
   * column length.
   */
  @IsString()
  @IsNotEmpty()
  @Length(1, 500)
  address!: string;

  /** Required for the same reason (DEF-03); `phone` is `varchar(50) NOT NULL`. */
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  phone!: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
