import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DefThrottlerGuard } from './def-throttler.guard';
import { THROTTLE_NAMES } from './throttle.config';

/**
 * Per-route throttling (DEF-07 Q1). Only the five unauthenticated endpoints are
 * throttled — the guard is applied per route, never globally — and each route
 * keeps exactly the counters that belong to it: a guarded route would otherwise
 * run every throttler the module defines.
 *
 * `GET /v1/health` is therefore exempt by construction (Q10): it carries no
 * guard at all, as do all authenticated routes.
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
