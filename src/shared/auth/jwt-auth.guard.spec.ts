import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { CACHE_CALL_TIMEOUT_MS_DEFAULT } from '../cache/bounded-cache-call';
import {
  CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  ServiceUnavailableWithRetryException,
} from '../cache/cache-unavailable.exception';

/** Real timers must not leak out of the one test that installs fake ones. */
afterEach(() => {
  jest.useRealTimers();
});

function mockContext(  authHeader: string | undefined,
  isPublic = false,
): ExecutionContext {
  const handler = () => {};
  if (isPublic) {
    Reflect.defineMetadata('isPublic', true, handler);
  }
  const req: Record<string, any> = {
    headers: {
      authorization: authHeader,
      'Authorization': authHeader,
    },
    user: undefined,
  };
  return {
    getHandler: () => handler,
    getClass: () => ({} as any),
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard — Security (H2)', () => {
  let guard: JwtAuthGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockJwtService: jest.Mocked<JwtService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  // `store.client` is part of the shape a real cache-manager `Cache` always has,
  // and DEF-15 reads it to check readiness before the blacklist round trip.
  let mockCache: { get: jest.Mock; set: jest.Mock; store: { client: { isReady: boolean } } };

  beforeEach(async () => {
    mockReflector = new Reflector() as jest.Mocked<Reflector>;
    mockJwtService = {
      verifyAsync: jest.fn(),
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;
    mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
      store: { client: { isReady: true } },
    };

    guard = new JwtAuthGuard(
      mockReflector,
      mockJwtService,
      mockConfigService,
      mockCache as any,
    );
  });

  // ---- Public routes pass through ----
  it('allows public routes without any token', async () => {
    await expect(
      guard.canActivate(mockContext(undefined, true)),
    ).resolves.toBe(true);
  });

  // ---- Missing / malformed Authorization header ----
  it('rejects requests with no Authorization header', async () => {
    await expect(guard.canActivate(mockContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects requests with a non-Bearer Authorization header', async () => {
    await expect(guard.canActivate(mockContext('Basic abc123'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects requests with an empty Bearer token', async () => {
    await expect(guard.canActivate(mockContext('Bearer '))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // ---- Malformed / expired JWT ----
  it('rejects a malformed JWT', async () => {
    mockJwtService.verifyAsync.mockRejectedValue(new Error('jwt malformed'));
    await expect(
      guard.canActivate(mockContext('Bearer garbage-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired JWT', async () => {
    mockJwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect(
      guard.canActivate(mockContext('Bearer expired-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ---- JWT token-type enforcement ----
  it('rejects a refresh-token JWT on a protected endpoint', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      email: 'test@test.com',
      tokenType: 'refresh',
    });
    await expect(
      guard.canActivate(mockContext('Bearer valid-refresh-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a challenge-token JWT on a protected endpoint', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      email: 'test@test.com',
      tokenType: 'challenge',
    });
    await expect(
      guard.canActivate(mockContext('Bearer valid-challenge-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts an access-token JWT (happy path)', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      email: 'test@test.com',
      tokenType: 'access',
    });
    const ctx = mockContext('Bearer valid-access-token');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe('u1');
  });

  // ---- Blacklist / fail-closed ----
  it('rejects a blacklisted token', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      email: 'test@test.com',
      tokenType: 'access',
    });
    mockCache.get.mockResolvedValue('true'); // blacklisted

    await expect(
      guard.canActivate(mockContext('Bearer blacklisted-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails CLOSED when Redis is unreachable (cache throws), answering 503 not 401', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      email: 'test@test.com',
      tokenType: 'access',
    });
    mockCache.get.mockRejectedValue(new Error('Redis connection refused'));

    // O1 (2026-10-04): the refusal is unchanged — the token is NOT accepted —
    // but it is no longer reported to the client as an invalid session.
    await expect(
      guard.canActivate(mockContext('Bearer good-token-but-redis-down')),
    ).rejects.toBeInstanceOf(ServiceUnavailableWithRetryException);
  });

  // ---- DEF-15 / O1: the blacklist read is bounded AND answers 503 on an outage ----
  describe('infrastructure failure on the blacklist read', () => {
    /** The blackholed-socket shape: queued forever, no reply and no error. */
    const neverSettles = () => new Promise<never>(() => undefined);

    beforeEach(() => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'u1',
        email: 'test@test.com',
        tokenType: 'access',
      });
    });

    it('rejects with the 503 (Retry-After carried) when the blacklist read never answers', async () => {
      // Fake timers so a removed deadline fails an ASSERTION here rather than
      // hanging until jest's 5 s timeout — a hang reports the runner, not the
      // defect. The guard reads the default deadline (the mocked ConfigService
      // answers `undefined` for anything but JWT_SECRET).
      jest.useFakeTimers();
      mockCache.get.mockImplementation(neverSettles);
      let caught: unknown = '(still pending: the guard never answered)';

      void guard
        .canActivate(mockContext('Bearer never-answered'))
        .catch((error: unknown) => {
          caught = error;
        });

      await jest.advanceTimersByTimeAsync(CACHE_CALL_TIMEOUT_MS_DEFAULT);

      expect(caught).toBeInstanceOf(ServiceUnavailableWithRetryException);
      expect((caught as ServiceUnavailableWithRetryException).getStatus()).toBe(503);
      expect((caught as ServiceUnavailableWithRetryException).retryAfterSeconds).toBe(
        CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS,
      );
      // The DEADLINE ended it, not the readiness check: the operation really ran
      // and really was abandoned. `isReady` is true on this mock, so the
      // short-circuit is not what produced the answer.
      expect(mockCache.get).toHaveBeenCalled();
      expect(mockCache.store.client.isReady).toBe(true);
    });

    it('still answers 401 for a token that really is blacklisted', async () => {
      // The genuine answer must not be reachable through the 503 path.
      mockCache.get.mockResolvedValue('true');

      await expect(
        guard.canActivate(mockContext('Bearer blacklisted-token')),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('still admits a token that really is not blacklisted', async () => {
      mockCache.get.mockResolvedValue(undefined);

      await expect(guard.canActivate(mockContext('Bearer good-token'))).resolves.toBe(true);
    });
  });
});