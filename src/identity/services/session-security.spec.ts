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

describe('AuthService — Session Security (H2)', () => {
  let authService: AuthService;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  let mockJwtService: jest.Mocked<Partial<JwtService>>;
  let mockUserRepository: jest.Mocked<Partial<Repository<IdentityUser>>>;
  let mockCache: { set: jest.Mock; get: jest.Mock; store: { client: { set: jest.Mock } } };
  let mockMfaService: jest.Mocked<Partial<MfaService>>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'JWT_EXPIRATION') return '3600';
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        if (key === 'MFA_CHALLENGE_EXPIRATION') return '300';
        return defaultValue;
      }),
    } as jest.Mocked<Partial<ConfigService>>;

    const redisClient = { set: jest.fn() };
    mockCache = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(undefined),
      store: { client: redisClient },
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    } as unknown as jest.Mocked<Partial<JwtService>>;

    mockUserRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<Partial<Repository<IdentityUser>>>;

    const mockIdentityService = {} as jest.Mocked<Partial<IdentityService>>;

    mockMfaService = {
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      verifyTotp: jest.fn(),
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

  describe('MFA challenge replay protection', () => {
    beforeEach(() => {
      mockJwtService.verify = jest.fn().mockReturnValue({
        sub: 'user-1',
        email: 'a@b.com',
        tokenType: 'challenge',
        exp: Math.floor(Date.now() / 1000) + 300,
      });
      mockUserRepository.findOne = jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
      mockMfaService = {
        verifyTotp: jest.fn().mockResolvedValue(true),
      } as unknown as jest.Mocked<Partial<MfaService>>;
    });

    it('rejects a non-challenge token in verifyMfaAndLogin', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({
        sub: 'user-1',
        tokenType: 'access',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      await expect(
        authService.verifyMfaAndLogin('some-access-token', '123456'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an invalid/expired MFA challenge', async () => {
      mockJwtService.verify = jest.fn().mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        authService.verifyMfaAndLogin('expired-challenge', '123456'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a challenge when the OTP is invalid', async () => {
      (mockCache.store as any).client.set.mockResolvedValue('OK');
      mockMfaService.verifyTotp = jest.fn().mockResolvedValue(false);

      await expect(
        authService.verifyMfaAndLogin('challenge-token', 'wrong-otp'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh-token replay', () => {
    it('rejects a refresh token that has already been blacklisted (reuse detection)', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({
        sub: 'user-1',
        tokenType: 'refresh',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      mockCache.get.mockResolvedValue('true');

      await expect(
        authService.refreshToken('replayed-refresh-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a refresh endpoint when the refresh token is actually an access token', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({
        sub: 'user-1',
        tokenType: 'access',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await expect(
        authService.refreshToken('access-token-presented-as-refresh'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('after a successful logout, the access + refresh tokens are revoked', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({
        sub: 'user-1',
        tokenType: 'refresh',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      mockJwtService.decode = jest.fn().mockReturnValue({
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await authService.logout('user-1', 'access-token', 'refresh-token');

      expect(mockCache.set).toHaveBeenCalledWith(
        'blacklisted:refresh-token',
        'true',
        expect.any(Number),
      );
      expect(mockCache.set).toHaveBeenCalledWith(
        'blacklisted:access-token',
        'true',
        expect.any(Number),
      );
    });
  });

  describe('logout blacklist fail-closed', () => {
    it('throws UnauthorizedException when the blacklist check fails (Redis down)', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({
        sub: 'user-1',
        tokenType: 'refresh',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      mockCache.get.mockRejectedValue(new Error('Redis connection refused'));

      await expect(
        authService.refreshToken('some-refresh-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});