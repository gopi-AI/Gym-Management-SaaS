import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class MfaEnableDto {
  @IsString()
  otpCode: string;

  constructor(otpCode: string) {
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
