import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IdentityUser } from '../entities/identity-users.entity';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/common';

describe('AuthService', () => {
  let authService: AuthService;
  let mockConfigService: Partial<ConfigService>;
  let mockJwtService: Partial<JwtService>;
  let mockUserRepository: Partial<Repository<IdentityUser>>;
  let mockCache: any;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'JWT_EXPIRATION') return '3600';
        return defaultValue;
      }),
    };

    mockJwtService = {
      sign: jest.fn(),
    };

    mockUserRepository = {
      findOne: jest.fn(),
    };

    mockCache = {
      set: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: getRepositoryToken(IdentityUser),
          useValue: mockUserRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCache,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  describe('logout', () => {
    it('should blacklist the token when called', async () => {
      const userId = 'test-user-id';
      const token = 'test-token';
      
      await authService.logout(userId, token);
      
      expect(mockCache.set).toHaveBeenCalledWith(
        `blacklisted:${token}`,
        'true',
        3600
      );
    });

    it('should not fail when cache is not available', async () => {
      // Override config to return undefined for cache
      mockConfigService.get = jest.fn((key: string) => {
        if (key === 'JWT_EXPIRATION') return '3600';
        return undefined;
      });

      const userId = 'test-user-id';
      const token = 'test-token';
      
      // Should not throw any error
      await expect(authService.logout(userId, token)).resolves.not.toThrow();
    });
  });

  describe('isTokenBlacklisted', () => {
    it('should return true when token is blacklisted', async () => {
      const token = 'test-token';
      mockCache.get = jest.fn().mockResolvedValue('true');
      
      const result = await authService.isTokenBlacklisted(token);
      
      expect(result).toBe(true);
      expect(mockCache.get).toHaveBeenCalledWith(`blacklisted:${token}`);
    });

    it('should return false when token is not blacklisted', async () => {
      const token = 'test-token';
      mockCache.get = jest.fn().mockResolvedValue(undefined);
      
      const result = await authService.isTokenBlacklisted(token);
      
      expect(result).toBe(false);
      expect(mockCache.get).toHaveBeenCalledWith(`blacklisted:${token}`);
    });

    it('should return false when cache is not available', async () => {
      // Override config to return undefined for cache
      mockConfigService.get = jest.fn((key: string) => {
        if (key === 'JWT_EXPIRATION') return '3600';
        return undefined;
      });

      const token = 'test-token';
      
      const result = await authService.isTokenBlacklisted(token);
      
      expect(result).toBe(false);
    });
  });
});