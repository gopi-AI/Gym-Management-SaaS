import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class MfaEnableDto {
  /**
   * The CURRENT TOTP code, required only when MFA is already enabled.
   *
   * A first-time enrollee has no secret yet and therefore cannot produce a
   * code, so the field is optional here; the rule lives in
   * `MfaService.startEnrollment`, which demands a valid code whenever
   * `is_mfa_enabled` is true (owner ruling 2026-10-05). An MFA-off caller that
   * omits it is enrolled exactly as before.
   */
  @IsString()
  @IsOptional()
  otpCode?: string;

  constructor(otpCode?: string) {
    this.otpCode = otpCode;
  }
}

export class MfaDisableDto {
  @IsString()
  otpCode: string;

  @IsBoolean()
  @IsOptional()
  force?: boolean;

  constructor(otpCode: string) {
    this.otpCode = otpCode;
  }
}

export class MfaVerifyDto {
  @IsString()
  otpCode: string;

  constructor(otpCode: string) {
    this.otpCode = otpCode;
  }
}

export class MfaCheckDto {
  @IsBoolean()
  isMfaEnabled: boolean;

  constructor(isMfaEnabled: boolean) {
    this.isMfaEnabled = isMfaEnabled;
  }
}
