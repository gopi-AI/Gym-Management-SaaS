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

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<any> {
    // Hash the password and create user via AuthService (fixed)
    const user = await this.authService.registerUser(dto);
    const { password_hash, ...result } = user;
    return result;
  }

  @Public()
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
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Post('verify-mfa')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Body() dto: VerifyMfaDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.verifyMfaAndLogin(dto.challengeToken, dto.otpCode);
  }

  @Post('mfa-enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async enableMfa(@CurrentUser() user: { userId: string }, @Body() dto: MfaEnableDto): Promise<{ secret: string; provisioningUri: string }> {
    // First generate a secret for the authenticated user
    const { secret, provisioningUri } = await this.authService.mfaService.generateSecret(user.userId);

    // Store the secret for the user (this will be verified on the next step)
    await this.authService.mfaService.storeSecret(user.userId, secret);

    return { secret, provisioningUri };
  }

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
