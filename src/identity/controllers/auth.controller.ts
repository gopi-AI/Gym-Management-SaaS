import { randomUUID } from 'crypto';
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { IdentityUser } from '../entities/identity-users.entity';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';

@Controller('v1/auth')
export class AuthController {
  constructor() {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<IdentityUser> {
    // In a real implementation, hash the password before saving
    // For now, create the user with the provided data
    return {
      id: randomUUID(),
      password_hash: dto.password,
      ...dto,
      is_active: true,
      email_verified: false,
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as IdentityUser;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    // In a real implementation, validate password against hash
    // For now, return success if email is provided
    return {
      accessToken: 'placeholder-jwt-token',
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<{ accessToken: string }> {
    // In a real implementation, validate refresh token and issue new access token
    return {
      accessToken: 'placeholder-jwt-token',
    };
  }
}