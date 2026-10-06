import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { VerifyMfaDto } from '../dto/verify-mfa.dto';
import { MfaEnableDto, MfaDisableDto, MfaVerifyDto, MfaCheckDto } from '../dto/mfa-enable.dto';
import { AuthService } from '../services/auth.service';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { Public } from '../../shared/auth/public.decorator';
import {
  ThrottleLogin,
  ThrottleMfaDisable,
  ThrottleMfaEnable,
  ThrottleMfaVerify,
  ThrottleRefresh,
  ThrottleRegister,
  ThrottleVerifyMfa,
} from '../../shared/throttling/throttle.decorators';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @ThrottleRegister()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<any> {
    // Hash the password and create user via AuthService (fixed)
    const user = await this.authService.registerUser(dto);
    const { password_hash, ...result } = user;
    return result;
  }

  @Public()
  @ThrottleLogin()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
  ): Promise<{ accessToken?: string; refreshToken?: string; mfaRequired?: boolean; challenge?: string }> {
    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Public()
  @ThrottleRefresh()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Public()
  @ThrottleVerifyMfa()
  @Post('verify-mfa')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Body() dto: VerifyMfaDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.verifyMfaAndLogin(dto.challengeToken, dto.otpCode);
  }

  // Throttled per authenticated user (owner ruling 2026-10-05): this route
  // consumes a TOTP, so an unlimited caller can guess 6 digits. The bucket is
  // this user's alone and is separate from `mfa-disable`'s.
  @ThrottleMfaEnable()
  @Post('mfa-enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async enableMfa(@CurrentUser() user: { userId: string }, @Body() dto: MfaEnableDto): Promise<{ secret: string; provisioningUri: string }> {
    // `startEnrollment` enforces the re-authentication rule (owner ruling
    // 2026-10-05): when MFA is already enabled the CURRENT TOTP must be valid
    // before anything is generated or stored. It returns null when that check
    // fails, and the answer mirrors `mfa-disable`'s bad-code path: a 401 with a
    // message that names neither the stored state nor the secret.
    const enrollment = await this.authService.mfaService.startEnrollment(
      user.userId,
      dto.otpCode,
    );
    if (!enrollment) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    return enrollment;
  }

  // Throttled per authenticated user (DEF-23): the same `mfaUserTracker` the two
  // MFA write routes use, on its own counter. This route answers a boolean for a
  // submitted code, so without a limit it is an oracle over the active secret —
  // and it is the oracle that made DEF-22's two counters bypassable by
  // sequencing. A legitimate enrollment costs one call.
  @ThrottleMfaVerify()
  @Post('mfa-verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async verifyMfaSetup(@CurrentUser() user: { userId: string }, @Body() dto: MfaVerifyDto): Promise<{ success: boolean }> {
    // Verify the OTP code against the stored secret
    const isValid = await this.authService.mfaService.verifyTotp(user.userId, dto.otpCode);

    if (!isValid) {
      return { success: false };
    }

    // If valid, enable MFA for the user
    await this.authService.mfaService.enableMfa(user.userId);

    return { success: true };
  }

  // Throttled per authenticated user (owner ruling 2026-10-05), on its own
  // counter: spending `mfa-enable`'s budget leaves this route usable.
  @ThrottleMfaDisable()
  @Post('mfa-disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async disableMfa(@CurrentUser() user: { userId: string }, @Body() dto: MfaDisableDto): Promise<{ success: boolean }> {
    const success = await this.authService.mfaService.disableMfa(user.userId, dto.otpCode);

    if (!success) {
      throw new UnauthorizedException('Invalid TOTP code or MFA not enabled');
    }

    return { success: true };
  }

  @Post('mfa-check')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async checkMfaStatus(@CurrentUser() user: { userId: string }): Promise<MfaCheckDto> {
    const isMfaEnabled = await this.authService.mfaService.isMfaEnabled(user.userId);
    return { isMfaEnabled };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: { userId: string },
    @Req() req: { headers: Record<string, string | undefined> },
    @Body() dto: { refreshToken?: string },
  ): Promise<{ success: boolean }> {
    const authHeader = (req.headers.authorization as string) ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    await this.authService.logout(user.userId, accessToken, dto?.refreshToken);
    return { success: true };
  }
}
