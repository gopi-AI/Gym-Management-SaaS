import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IdentityUser } from '../entities/identity-users.entity';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { IdentityService } from './identity.service';
import { MfaService } from './mfa.service';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let authService: AuthService;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  let mockJwtService: jest.Mocked<Partial<JwtService>>;
  let mockUserRepository: jest.Mocked<Partial<Repository<IdentityUser>>>;
  let mockCache: jest.Mocked<{ set: jest.Mock; get: jest.Mock }>;
  let mockIdentityService: jest.Mocked<Partial<IdentityService>>;
  let mockMfaService: jest.Mocked<Partial<MfaService>>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'JWT_EXPIRATION') return '3600';
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        return defaultValue;
      }),
    } as jest.Mocked<Partial<ConfigService>>;

    mockJwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
      decode: jest.fn(),
    } as unknown as jest.Mocked<Partial<JwtService>>;

    mockUserRepository = {
      findOne: jest.fn(),
    } as jest.Mocked<Partial<Repository<IdentityUser>>>;

    mockCache = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(undefined),
    };

    mockIdentityService = {
      createUser: jest.fn(),
      hasPermission: jest.fn(),
    } as unknown as jest.Mocked<Partial<IdentityService>>;

    mockMfaService = {
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      verifyTotp: jest.fn(),
      generateSecret: jest.fn(),
      storeSecret: jest.fn(),
      enableMfa: jest.fn(),
      disableMfa: jest.fn(),
    } as unknown as jest.Mocked<Partial<MfaService>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: getRepositoryToken(IdentityUser), useValue: mockUserRepository },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: IdentityService, useValue: mockIdentityService },
        { provide: MfaService, useValue: mockMfaService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  describe('logout', () => {
    it('should blacklist the access token (uses cache manager with TTL in ms)', async () => {
      const userId = 'test-user-id';
      const token = 'test-token';

      mockJwtService.decode = jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });

      await authService.logout(userId, token);

      expect(mockCache.set).toHaveBeenCalledWith(
        `blacklisted:${token}`,
        'true',
        expect.any(Number),
      );
      const setCall = mockCache.set.mock.calls[0] as [string, string, number];
      expect(setCall[2]).toBeGreaterThan(3_500_000);
      expect(setCall[2]).toBeLessThan(3_700_000);
    });

    it('should also blacklist the refresh token when provided', async () => {
      const userId = 'test-user-id';
      const accessToken = 'access-token';
      const refreshToken = 'refresh-token';

      mockJwtService.decode = jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
      mockJwtService.verify = jest.fn().mockReturnValue({ sub: userId, tokenType: 'refresh', exp: Math.floor(Date.now() / 1000) + 3600 });

      await authService.logout(userId, accessToken, refreshToken);

      expect(mockCache.set).toHaveBeenCalledTimes(2);
      expect(mockCache.set).toHaveBeenCalledWith(
        `blacklisted:${accessToken}`,
        'true',
        expect.any(Number),
      );
      expect(mockCache.set).toHaveBeenCalledWith(
        `blacklisted:${refreshToken}`,
        'true',
        expect.any(Number),
      );
    });

    it('should not fail when the token is already expired', async () => {
      const userId = 'test-user-id';
      const token = 'test-token';

      // Token exp in the past => tokenTtlSeconds falls back to configured
      // JWT_EXPIRATION (3600s). The logout still completes without throwing and
      // still records the blacklist entry (harmless: the entry expires quickly and is
      // only consulted for non-expired tokens).
      mockJwtService.decode = jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) - 10 });

      await expect(authService.logout(userId, token)).resolves.not.toThrow();
      expect(mockCache.set).toHaveBeenCalledWith(
        `blacklisted:${token}`,
        'true',
        expect.any(Number),
      );
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

    it('should fail CLOSED (throw UnauthorizedException) when cache is unavailable', async () => {
      const token = 'test-token';
      mockCache.get = jest.fn().mockRejectedValue(new Error('Redis connection refused'));

      await expect(authService.isTokenBlacklisted(token)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(authService.isTokenBlacklisted(token)).rejects.toThrow(
        'Authentication backend unavailable',
      );
    });
  });
});