import { IsJWT, IsString, Length } from 'class-validator';

/**
 * DTO for completing an MFA login challenge.
 *
 * The `challengeToken` is the short-lived, signed, single-use token issued by
 * `POST /v1/auth/login` when the account has MFA enabled. It binds the TOTP
 * verification to the user established during password authentication — the
 * client never supplies a userId here.
 */
export class VerifyMfaDto {
  @IsJWT()
  @IsString()
  challengeToken!: string;

  @IsString()
  @Length(6, 8, { message: 'TOTP code must be 6-8 digits' })
  otpCode!: string;
}
