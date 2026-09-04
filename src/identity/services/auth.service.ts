import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdentityUser } from '../entities/identity-users.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(IdentityUser)
    private readonly userRepository: Repository<IdentityUser>,
  ) {}

  async validateUser(email: string, password: string): Promise<IdentityUser | null> {
    const user = await this.userRepository.findOne({
      where: { email },
    });
    
    if (!user || !user.is_active) {
      return null;
    }
    
    // In a real implementation, compare password with hash
    // For now, return user if email matches
    return user.is_active ? user : null;
  }

  async login(user: IdentityUser) {
    const payload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  async refreshToken(userId: string): Promise<{ accessToken: string }> {
    const payload = { sub: userId };
    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  async logout(userId: string, token: string): Promise<void> {
    // In a real implementation, you should store the token in a blacklist cache
    // or database with an expiry time to prevent reuse
    // For now, we'll store it in memory-cache with a short expiry
    const cache = this.configService.get('cache');
    if (cache) {
      // Store token with expiration in cache
      const expirySeconds = parseInt(this.configService.get('JWT_EXPIRATION', '3600'));
      await cache.set(`blacklisted:${token}`, 'true', expirySeconds);
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const cache = this.configService.get('cache');
    if (cache) {
      const result = await cache.get(`blacklisted:${token}`);
      return result !== undefined;
    }
    return false;
  }
}