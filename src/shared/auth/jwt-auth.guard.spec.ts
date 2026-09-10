import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

function mockContext(
  authHeader: string | undefined,
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
  let mockCache: { get: jest.Mock; set: jest.Mock };

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

  it('fails CLOSED when Redis is unreachable (cache throws)', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      email: 'test@test.com',
      tokenType: 'access',
    });
    mockCache.get.mockRejectedValue(new Error('Redis connection refused'));

    await expect(
      guard.canActivate(mockContext('Bearer good-token-but-redis-down')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});