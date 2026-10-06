import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DefThrottlerGuard } from './def-throttler.guard';
import { THROTTLE_NAMES } from './throttle.config';

/**
 * Per-route throttling (DEF-07 Q1). The guard is applied per route, never
 * globally, and each route keeps exactly the counters that belong to it: a
 * guarded route would otherwise run every throttler the module defines.
 *
 * `GET /v1/health` and the authenticated routes are exempt by construction
 * (Q10): they carry no guard at all — except the two MFA write routes below,
 * which the owner ruling of 2026-10-05 brought into scope by amending Q1 for
 * them alone. That amendment is narrow: it is not a rule that authenticated
 * routes are throttled.
 */
const only = (...keep: string[]) =>
  SkipThrottle(
    Object.fromEntries(THROTTLE_NAMES.filter((name) => !keep.includes(name)).map((name) => [name, true])),
  );

export const ThrottleLogin = () =>
  applyDecorators(UseGuards(DefThrottlerGuard), only('login-ip', 'login-pair'));

export const ThrottleRegister = () => applyDecorators(UseGuards(DefThrottlerGuard), only('register-ip'));

export const ThrottleRefresh = () => applyDecorators(UseGuards(DefThrottlerGuard), only('refresh-ip'));

export const ThrottleVerifyMfa = () =>
  applyDecorators(UseGuards(DefThrottlerGuard), only('verify-mfa-ip'));

export const ThrottleWebhook = () => applyDecorators(UseGuards(DefThrottlerGuard), only('webhook-ip'));

/**
 * The two authenticated MFA write routes (owner ruling 2026-10-05): 20/min per
 * authenticated user, one bucket each. Each keeps its own counter and nothing
 * else — the `only` filter skips the other seven names: the six IP-keyed
 * counters, which would otherwise run against these callers, and the sibling
 * route's user counter, so spending one route's budget leaves the other usable.
 */
export const ThrottleMfaEnable = () =>
  applyDecorators(UseGuards(DefThrottlerGuard), only('mfa-enable-user'));

export const ThrottleMfaDisable = () =>
  applyDecorators(UseGuards(DefThrottlerGuard), only('mfa-disable-user'));
