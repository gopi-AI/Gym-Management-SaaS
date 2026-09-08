import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = authHeader.slice(7).trim();
    if (!token) throw new UnauthorizedException('Empty bearer token');

    let payload: { sub: string; email: string; jti?: string; exp?: number; tokenType?: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Enforce token purpose: only access-type tokens may authenticate
    // protected API routes.  Refresh and challenge tokens are rejected even
    // when their signature and expiry are valid.
    if (payload.tokenType !== 'access') {
      throw new UnauthorizedException('Invalid token type for this endpoint');
    }

    // Blacklist check (fail closed if Redis is unavailable for security-sensitive paths)
    try {
      const blacklisted = await this.cacheManager.get<boolean>('blacklisted:' + token);
      if (blacklisted) throw new UnauthorizedException('Token has been revoked');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(
        'Blacklist check failed (failing closed): ' + (err as Error).message,
      );
      throw new UnauthorizedException('Authentication backend unavailable');
    }

    req.user = {
      userId: payload.sub,
      email: payload.email,
      jti: payload.jti,
      exp: payload.exp,
    };
    req.accessToken = token;
    return true;
  }
}