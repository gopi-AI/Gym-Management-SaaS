import { IsString, IsOptional, Matches, MaxLength } from 'class-validator';

export class UpdateBranchSettingsDto {
  /**
   * All three fields are optional (PATCH semantics):
   * - omitted (undefined) → override is cleared / ignored (field untouched)
   * - explicit null     → clear this override back to the inherited value
   */
  @IsOptional()
  @IsString()
  time_zone?: string | null;

  @IsOptional()
  @IsString()
  locale?: string | null;

  /**
   * `Matches` enforces the iso-4217 three-letter code shape; kept permissive,
   * but the DB column is `varchar(3)` so any 3-char value would fit either way.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  @MaxLength(3)
  currency?: string | null;
}
