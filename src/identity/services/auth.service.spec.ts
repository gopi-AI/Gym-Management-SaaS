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
import {
  CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  ServiceUnavailableWithRetryException,
} from '../../shared/cache/cache-unavailable.exception';

describe('AuthService', () => {
  let authService: AuthService;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  // Mutable so a single test can describe a different environment; the shared
  // mock below reads these, and `beforeEach` resets them.
  let mockNodeEnv: string | undefined;
  let mockJwtSecret: string | undefined;
  let mockJwtService: jest.Mocked<Partial<JwtService>>;
  let mockUserRepository: jest.Mocked<Partial<Repository<IdentityUser>>>;
  // `store.client` is part of the shape a real cache-manager `Cache` always has,
  // and DEF-15 reads it to check the client is ready before each bounded call.
  let mockCache: jest.Mocked<{
    set: jest.Mock;
    get: jest.Mock;
    store: { client: { isReady: boolean; set: jest.Mock } };
  }>;
  let mockIdentityService: jest.Mocked<Partial<IdentityService>>;
  let mockMfaService: jest.Mocked<Partial<MfaService>>;

  beforeEach(async () => {
    // `test` is the NODE_ENV jest itself pins (jest-cli/bin/jest.js), so the
    // suite runs the same allowed environment a CI/spec boot does.
    mockNodeEnv = 'test';
    mockJwtSecret = 'unit-test-secret';

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'JWT_EXPIRATION') return '3600';
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        if (key === 'JWT_SECRET') return mockJwtSecret;
        if (key === 'NODE_ENV') return mockNodeEnv;
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
      store: {
        client: {
          isReady: true,
          // The MFA challenge claim is `SET ... NX` on the raw client; `null`
          // is the driver's "the key already existed" answer.
          set: jest.fn().mockResolvedValue('OK'),
        },
      },
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

  describe('development JWT fallback scope (owner ruling 2026-10-05)', () => {
    const user = { id: 'user-1', email: 'user@example.com' } as IdentityUser;

    it('signs access and challenge tokens with the fallback in test, where it is allowed', async () => {
      mockJwtSecret = undefined; // no real secret; `test` still allows the fallback

      const result = await authService.login(user);

      expect(result.accessToken).toBe('signed-token');
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ tokenType: 'access' }),
        expect.objectContaining({ secret: 'dev-secret-change-me' }),
      );
    });

    it('refuses to mint a token when NODE_ENV forbids the development fallback', async () => {
      mockNodeEnv = 'staging';
      mockJwtSecret = undefined;

      await expect(authService.login(user)).rejects.toThrow(
        /JWT_SECRET must be set/,
      );
    });

    it('refuses to mint a token when NODE_ENV is unset and the secret is missing', async () => {
      mockNodeEnv = undefined;
      mockJwtSecret = undefined;

      await expect(authService.login(user)).rejects.toThrow(
        /JWT_SECRET must be set/,
      );
    });
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

    it('should fail CLOSED (503, not 401) when cache is unavailable', async () => {
      const token = 'test-token';
      mockCache.get = jest.fn().mockRejectedValue(new Error('Redis connection refused'));

      // The refusal is unchanged — an unreachable cache never reports the token
      // as good — but O1 (2026-10-04) reports it as 503 + Retry-After so the web
      // client does not treat a Redis outage as an invalid session.
      await expect(authService.isTokenBlacklisted(token)).rejects.toBeInstanceOf(
        ServiceUnavailableWithRetryException,
      );
      await expect(authService.isTokenBlacklisted(token)).rejects.toThrow(
        'Authentication backend unavailable',
      );
      await expect(authService.isTokenBlacklisted(token)).rejects.toMatchObject({
        retryAfterSeconds: CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // DEF-15: a cache call that never answers must not hold the request open
  // ---------------------------------------------------------------------------
  describe('DEF-15 bounded cache calls', () => {
    // The blackholed-socket shape: the command is queued forever with no reply
    // and no error, which is what the real driver does while it reconnects.
    const neverSettles = () => new Promise<never>(() => undefined);

    const expectCacheUnavailable = async (promise: Promise<unknown>): Promise<void> => {
      const caught = await promise.catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(ServiceUnavailableWithRetryException);
      expect((caught as ServiceUnavailableWithRetryException).getStatus()).toBe(503);
      expect((caught as ServiceUnavailableWithRetryException).retryAfterSeconds).toBe(
        CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS,
      );
    };

    it('refuses with 503, not 401, when the blacklist read never answers', async () => {
      // O1 (2026-10-04): this is the REFRESH path's revocation read. A 401 here
      // told the web client the refresh token was revoked, so it cleared the
      // tokens and signed the user out of a session that was still valid.
      mockCache.get.mockImplementation(neverSettles);
      const started = Date.now();

      await expectCacheUnavailable(authService.isTokenBlacklisted('tok'));
      // Upper bound only: what is under test is that it returned at all.
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('does not report a completed logout when the blacklist write never answers', async () => {
      mockCache.set.mockImplementation(neverSettles);
      const started = Date.now();

      // The write is NOT swallowed: the caller must not be told the revocation
      // succeeded. It is now a 503 rather than a bare error — it reached the
      // client as an unplanned 500 before O1.
      await expectCacheUnavailable(authService.logout('user-1', 'access-token'));
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('refuses the MFA challenge with 503, not 401, when the claim never answers', async () => {
      (mockJwtService.verify as jest.Mock).mockReturnValue({
        sub: 'user-1',
        email: 'probe@example.test',
        tokenType: 'challenge',
        exp: Math.floor(Date.now() / 1000) + 300,
      });
      mockCache.store.client.set.mockImplementation(neverSettles);
      const started = Date.now();

      await expectCacheUnavailable(authService.verifyMfaAndLogin('challenge-token', '123456'));
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('does not reach the cache at all when the client reports it is not ready', async () => {
      mockCache.store.client.isReady = false;

      await expectCacheUnavailable(authService.isTokenBlacklisted('tok'));
      expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('still answers 401 for a genuine revocation, never through the 503 path', async () => {
      // The real ANSWER must be unreachable from the infrastructure branch. This
      // is the refresh path: the read SUCCEEDS and reports the token revoked, so
      // the 401 is a revocation answer, not an outage.
      (mockJwtService.verify as jest.Mock).mockReturnValue({
        sub: 'user-1',
        email: 'probe@example.test',
        tokenType: 'refresh',
        exp: Math.floor(Date.now() / 1000) + 3_000,
      });
      mockCache.get.mockResolvedValue('true');

      const caught = await authService
        .refreshToken('revoked-refresh-token')
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(UnauthorizedException);
      expect(caught).not.toBeInstanceOf(ServiceUnavailableWithRetryException);
    });

    it('still reports a replay (SET NX returns null) as a 401, not a 503', async () => {
      // `null` is a real answer — the challenge was already consumed — and is not
      // an infrastructure failure, even though it comes from the same call.
      (mockJwtService.verify as jest.Mock).mockReturnValue({
        sub: 'user-1',
        email: 'probe@example.test',
        tokenType: 'challenge',
        exp: Math.floor(Date.now() / 1000) + 300,
      });
      mockCache.store.client.set.mockResolvedValue(null);

      const caught = await authService
        .verifyMfaAndLogin('challenge-token', '123456')
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(UnauthorizedException);
      expect(caught).not.toBeInstanceOf(ServiceUnavailableWithRetryException);
    });
  });
});