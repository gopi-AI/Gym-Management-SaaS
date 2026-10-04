import { Injectable, Inject, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  boundedCacheCall,
  cacheCallTimeoutFrom,
  CacheUnavailableError,
} from '../../shared/cache/bounded-cache-call';
import { ServiceUnavailableWithRetryException } from '../../shared/cache/cache-unavailable.exception';
import { IdentityUser } from '../entities/identity-users.entity';
import * as bcrypt from 'bcrypt';
import { IdentityService } from './identity.service';
import { RegisterDto } from '../dto/register.dto';
import { MfaService } from './mfa.service';
import { resolveJwtSecret } from '../../shared/auth/jwt-secret';

/**
 * Token purpose claims.
 *
 * Every JWT minted by this service carries a distinct `tokenType` so a
 * credential authenticated for one use can never be replayed elsewhere — even
 * when `JWT_REFRESH_SECRET` is unset and tokens are signed with JWT_SECRET.
 */
const TOKEN_TYPE_ACCESS = 'access';
const TOKEN_TYPE_REFRESH = 'refresh';
const TOKEN_TYPE_CHALLENGE = 'challenge';

/** The node-redis subset the MFA challenge claim needs (`SET ... NX`). */
interface RedisSetClient {
  readonly isReady?: boolean;
  set(
    key: string,
    value: string,
    options: { PX?: number; EX?: number; NX?: boolean },
  ): Promise<string | null>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /**
   * DEF-15: every cache call below is a request-path call and runs under this
   * deadline, so an unreachable Redis reaches the surrounding error path
   * instead of holding the request open for the whole outage.
   */
  private readonly cacheTimeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly identityService: IdentityService,
    @InjectRepository(IdentityUser)
    private readonly userRepository: Repository<IdentityUser>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    public readonly mfaService: MfaService,
  ) {
    this.cacheTimeoutMs = cacheCallTimeoutFrom(this.configService);
  }

  async registerUser(registerDto: RegisterDto): Promise<IdentityUser> {
    const passwordHash = await bcrypt.hash(registerDto.password, 10);
    return this.identityService.createUser({
      email: registerDto.email,
      passwordHash,
      firstName: registerDto.first_name,
      lastName: registerDto.last_name,
      phone: registerDto.phone,
    });
  }

  async validateUser(email: string, password: string): Promise<IdentityUser | null> {
    const user = await this.userRepository.findOne({
      where: { email, is_active: true },
    });

    if (!user) {
      return null;
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (passwordValid) {
      return user;
    }
    return null;
  }

  /**
   * Login a user.
   *
   * - MFA disabled: issues the `{ accessToken, refreshToken }` pair.
   * - MFA enabled: issues a short-lived, single-use `challenge` JWT
   *   (tokenType "challenge") that must be exchanged via `verifyMfaAndLogin`
   *   together with a valid TOTP code. No credentials are issued yet.
   */
  async login(user: IdentityUser): Promise<{
    accessToken?: string;
    refreshToken?: string;
    mfaRequired?: boolean;
    challenge?: string;
  }> {
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);

    if (mfaEnabled) {
      return {
        mfaRequired: true,
        challenge: this.signChallengeToken(user.id, user.email),
      };
    }

    const userPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.signAccessToken(userPayload),
      refreshToken: this.signRefreshToken(userPayload),
    };
  }

  /**
   * Verify an MFA challenge and issue the access/refresh token pair.
   *
   * The challenge token (issued by `login()` when MFA is enabled) is verified
   * here so the TOTP code is bound to the exact user that completed password
   * authentication — the client never supplies a userId.
   */
  async verifyMfaAndLogin(
    challengeToken: string,
    otpCode: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // 1) The challenge must be a valid, purpose-typed JWT that is not consumed.
    let challengePayload: { sub: string; email: string; tokenType?: string; exp?: number };
    try {
      challengePayload = this.jwtService.verify(challengeToken, {
        secret: this.getAccessSecret(),
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    if (challengePayload.tokenType !== TOKEN_TYPE_CHALLENGE || !challengePayload.sub) {
      throw new UnauthorizedException('Invalid MFA challenge');
    }

    // 2) Atomically claim the challenge (single-use, concurrent-safe).
    //    Uses SET NX on the raw Redis client.  If the key already exists the
    //    challenge has been consumed by another request — the two-step
    //    check-then-set race (isTokenBlacklisted + blacklistToken) is avoided.
    const ttl = this.tokenTtlSeconds(challengePayload.exp);
    const claimKey = `blacklisted:${challengeToken}`;
    // DEF-15: bounded. A claim that cannot be made must NOT be skipped — the
    // replay guard is the whole point of this step — so a failure still refuses
    // the challenge. O1 (2026-10-04): an infrastructure failure refuses it with
    // 503 + Retry-After rather than 401, so an unreachable Redis is not reported
    // to the client as a bad session. A claim that RETURNS NULL (the challenge
    // was already consumed) is a real answer and stays 401 below.
    let claimed: string | null;
    try {
      claimed = await boundedCacheCall(
        this.cacheManager,
        this.cacheTimeoutMs,
        'MFA challenge claim',
        (client: RedisSetClient) =>
          client.set(claimKey, JSON.stringify('true'), { PX: ttl * 1000, NX: true }),
      );
    } catch (error) {
      if (!(error instanceof CacheUnavailableError)) throw error;
      this.logger.error(
        'MFA challenge claim failed (failing closed): ' + error.message,
      );
      throw new ServiceUnavailableWithRetryException('Authentication backend unavailable');
    }
    if (claimed === null) {
      throw new UnauthorizedException('MFA challenge has already been used');
    }

    // 3) The TOTP code must be valid for the user bound to the challenge.
    if (!(await this.mfaService.verifyTotp(challengePayload.sub, otpCode))) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    // 4) The account must still exist and be active before issuing credentials.
    const user = await this.userRepository.findOne({
      where: { id: challengePayload.sub, is_active: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // 5) Issue the access/refresh token pair.
    const userPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.signAccessToken(userPayload),
      refreshToken: this.signRefreshToken(userPayload),
    };
  }

  /**
   * Exchange a refresh token for a fresh access token plus a rotated refresh token.
   *
   * The presented refresh token is verified (signature + expiry + purpose), the
   * account is re-checked, and only then is the old refresh token revoked for
   * the remainder of its natural lifetime.
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // 1) Signature and expiry must be valid against the refresh secret.
    let payload: { sub: string; email: string; tokenType?: string; exp?: number };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // 2) Purpose check: an access/challenge token can never be replayed here.
    if (payload.tokenType !== TOKEN_TYPE_REFRESH || !payload.sub) {
      throw new UnauthorizedException('Refresh token type mismatch');
    }

    // 3) Revocation check (logout / reuse detection).
    if (await this.isTokenBlacklisted(refreshToken)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // 4) The account must still exist and be active.
    const user = await this.userRepository.findOne({
      where: { id: payload.sub, is_active: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // 5) Rotate: revoke the presented token for its remaining lifetime, then
    //    issue a brand new access/refresh pair.
    await this.blacklistToken(refreshToken, payload.exp);

    const userPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.signAccessToken(userPayload),
      refreshToken: this.signRefreshToken(userPayload),
    };
  }

  /**
   * Revoke a user's credentials.
   *
   * The access token is always revoked. When the client can present the refresh
   * token as well, it is also revoked for its remaining lifetime.
   */
  async logout(userId: string, token: string, refreshToken?: string): Promise<void> {
    if (token) {
      await this.blacklistToken(token, this.decodeExp(token));
    }

    if (refreshToken) {
      let exp: number | undefined;
      try {
        const verified = this.jwtService.verify(refreshToken, {
          secret: this.getRefreshSecret(),
        });
        exp = (verified as { exp?: number }).exp;
      } catch {
        // Best-effort: fall back to an unverified decode, then to the configured TTL.
        exp = this.decodeExp(refreshToken);
      }
      await this.blacklistToken(refreshToken, exp);
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    // Check if the token is present in the Redis-backed blacklist cache.
    // Fail CLOSED: if the cache is unreachable we MUST treat the token as
    // blacklisted so revoked credentials are never accidentally accepted.
    // O1 (2026-10-04): "unreachable" answers 503 + Retry-After, not 401 — the
    // fail-closed decision is unchanged, only how it is reported to the client.
    // This is the refresh path's revocation read: a 401 here would make the web
    // client believe the REFRESH TOKEN is revoked, clear its tokens and sign the
    // user out (`apps/web/src/lib/api.ts:130-133` via `:151`).
    try {
      // DEF-15: bounded — the deadline is what lets this catch run during an
      // outage, instead of the read staying pending for its whole duration.
      const result = await boundedCacheCall(
        this.cacheManager,
        this.cacheTimeoutMs,
        'blacklist lookup',
        () => this.cacheManager.get(`blacklisted:${token}`),
      );
      return result !== undefined;
    } catch (err) {
      if (!(err instanceof CacheUnavailableError)) throw err;
      this.logger.error(
        'Blacklist lookup failed (failing closed): ' + err.message,
      );
      throw new ServiceUnavailableWithRetryException('Authentication backend unavailable');
    }
  }

  // ---------------------------------------------------------------------------
  // Token minting and blacklisting helpers
  // ---------------------------------------------------------------------------

  private getAccessSecret(): string {
    // Same shared rule as `validateEnv` and the `JwtModule` factory: the
    // development fallback is usable only in development/test. The boot
    // validation already refuses the other environments; repeating the rule here
    // means a bypassed (or runtime-changed) config can never silently sign with
    // the default — the same fail-closed shape `getRefreshSecret()` uses.
    return resolveJwtSecret(
      this.configService.get<string>('JWT_SECRET'),
      this.configService.get<string>('NODE_ENV'),
    );
  }

  private getRefreshSecret(): string {
    const secret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!secret) {
      // Fail closed: a missing refresh secret means refresh tokens cannot be
      // safely signed with a distinct key. The production startup validation in
      // app.module.ts enforces this, but we also fail here in case the config
      // changes at runtime or the validation is bypassed.
      throw new Error(
        'JWT_REFRESH_SECRET is not configured. It must be set to a value ' +
          'different from JWT_SECRET. Generate one with: openssl rand -base64 32',
      );
    }
    return secret;
  }

  /**
   * Normalise a TTL config value for jsonwebtoken's `expiresIn`. Plain numeric
   * strings ("3600") are treated as seconds, whereas human-readable spans
   * ("7d", "5m") pass through untouched.
   */
  private expiresIn(value: string | number | undefined, fallback: string | number): string | number {
    const raw = value ?? fallback;
    if (typeof raw === 'number') {
      return raw;
    }
    return /^\s*\d+\s*$/.test(raw) ? parseInt(raw, 10) : raw;
  }

  private secondsUntil(exp: number | undefined): number | undefined {
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      return undefined;
    }
    const remaining = exp - Math.floor(Date.now() / 1000);
    return remaining > 0 ? remaining : undefined;
  }

  /**
   * Parse a human-readable TTL ("3600", "5m", "2h", "7d", "500ms") into whole
   * seconds. Falls back to `fallback` when the value cannot be understood.
   */
  private ttlSeconds(ttl: string | number | undefined, fallback: number): number {
    if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0) {
      return Math.floor(ttl);
    }
    if (typeof ttl !== 'string') {
      return fallback;
    }
    const match = /^\s*(\d+)\s*(ms|s|m|h|d)?\s*$/i.exec(ttl);
    if (!match) {
      return fallback;
    }
    const value = parseInt(match[1], 10);
    const unit = (match[2] || 's').toLowerCase();
    switch (unit) {
      case 'ms':
        return Math.max(1, Math.floor(value / 1000));
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        return value; // plain seconds
    }
  }

  /**
   * Lifetime (seconds) a blacklist entry should live: the token's remaining
   * lifetime when known, otherwise the configured access-token TTL.
   */
  private tokenTtlSeconds(exp?: number): number {
    return this.secondsUntil(exp) ?? this.ttlSeconds(this.configService.get('JWT_EXPIRATION', '3600'), 3600);
  }

  /**
   * Best-effort read of a token's `exp` claim. Returns undefined when the token
   * cannot be decoded (e.g. it is not a JWT at all).
   */
  private decodeExp(token: string): number | undefined {
    try {
      const decoded = this.jwtService.decode(token) as { exp?: number } | null;
      return decoded?.exp;
    } catch {
      return undefined;
    }
  }

  private signAccessToken(userPayload: { sub: string; email: string }): string {
    return this.jwtService.sign(
      { ...userPayload, tokenType: TOKEN_TYPE_ACCESS },
      {
        secret: this.getAccessSecret(),
        expiresIn: this.expiresIn(this.configService.get('JWT_EXPIRATION', '3600'), 3600),
      },
    );
  }

  private signRefreshToken(userPayload: { sub: string; email: string }): string {
    return this.jwtService.sign(
      { ...userPayload, tokenType: TOKEN_TYPE_REFRESH },
      {
        secret: this.getRefreshSecret(),
        expiresIn: this.expiresIn(this.configService.get('JWT_REFRESH_EXPIRATION', '7d'), '7d'),
      },
    );
  }

  private signChallengeToken(sub: string, email: string): string {
    return this.jwtService.sign(
      { sub, email, tokenType: TOKEN_TYPE_CHALLENGE },
      {
        secret: this.getAccessSecret(),
        expiresIn: this.expiresIn(this.configService.get('MFA_CHALLENGE_EXPIRATION', '300'), 300),
      },
    );
  }

  /**
   * Store `blacklisted:<token>` in the shared cache for the token's remaining
   * lifetime. Already-expired tokens are skipped.
   */
  private async blacklistToken(token: string, exp?: number): Promise<void> {
    if (!token) {
      return;
    }
    const ttl = this.tokenTtlSeconds(exp);
    if (ttl <= 0) {
      return;
    }
    // cache-manager v5 (`cache-manager-redis-yet` Redis store) expresses TTLs
    // in milliseconds, so convert the seconds-based `ttl` before storing.
    // DEF-15: bounded, and deliberately NOT swallowed — if the revocation did
    // not happen, the caller (logout, refresh rotation) must not report success.
    // O1 (2026-10-04): a write that times out answers 503 + Retry-After. It was
    // an unplanned 500 before, because nothing caught it; a 500 tells the client
    // the request was broken, while 503 says the service is briefly unavailable
    // and the revocation did NOT happen. The callers keep their ordering —
    // `refreshToken` still revokes BEFORE issuing (so a timeout means no new
    // tokens and no rotation), and `logout` still does access then refresh.
    try {
      await boundedCacheCall(
        this.cacheManager,
        this.cacheTimeoutMs,
        'blacklist write',
        () => this.cacheManager.set(`blacklisted:${token}`, 'true', ttl * 1000),
      );
    } catch (error) {
      if (!(error instanceof CacheUnavailableError)) throw error;
      this.logger.error('Blacklist write failed (failing closed): ' + error.message);
      throw new ServiceUnavailableWithRetryException('Authentication backend unavailable');
    }
  }
}
