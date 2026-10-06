import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from '../../identity/controllers/auth.controller';
import { DefThrottlerGuard } from './def-throttler.guard';
import { THROTTLE_NAMES } from './throttle.config';

/**
 * Structural coverage for the two authenticated counters (owner ruling
 * 2026-10-05). The sibling spec `public-route-coverage.spec.ts` covers the
 * `@Public()` surface; this one pins the narrow amendment that brought
 * `mfa-enable` and `mfa-disable` into scope.
 *
 * WHY THE SKIP MAP IS THE ASSERTION, not just the presence of the guard: a
 * route is throttled by the counters it does NOT skip. `only(...)` skips every
 * name in `THROTTLE_NAMES` except the ones it is given, so a typo in a kept
 * name — `only('mfa-enable-userr')` — leaves the guard applied and skips all
 * eight counters: the route silently runs no throttler and only a behavioural
 * test over Redis would notice. Reading the map back makes that a hermetic
 * failure: the kept set is computed by asking the metadata which names are
 * skipped, so the typo yields an EMPTY set rather than the expected one.
 *
 * The neighbouring authenticated routes are pinned too, so the amendment
 * cannot spread without a new ruling and a deliberate edit here.
 */

type RouteHandler = (...args: never[]) => unknown;

const handlerOf = (name: keyof typeof AuthController.prototype): RouteHandler =>
  AuthController.prototype[name] as unknown as RouteHandler;

/** The counter names a handler does NOT skip — what it actually runs. */
const keptCounters = (handler: RouteHandler): string[] =>
  THROTTLE_NAMES.filter((name) => Reflect.getMetadata(THROTTLER_SKIP + name, handler) !== true);

const guardsOf = (handler: RouteHandler): unknown[] =>
  (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];

const isThrottled = (handler: RouteHandler): boolean =>
  guardsOf(handler).includes(DefThrottlerGuard);

describe('authenticated MFA route throttling (owner ruling 2026-10-05)', () => {
  it.each([
    ['enableMfa', 'mfa-enable-user'],
    ['disableMfa', 'mfa-disable-user'],
  ])('%s keeps exactly its own counter and carries the guard', (method, expected) => {
    const handler = handlerOf(method as keyof typeof AuthController.prototype);

    expect(isThrottled(handler)).toBe(true);
    expect(keptCounters(handler)).toEqual([expected]);
  });

  it('keeps the two counters under DIFFERENT names, so one route cannot spend the other', () => {
    const enable = keptCounters(handlerOf('enableMfa'));
    const disable = keptCounters(handlerOf('disableMfa'));

    expect(enable).not.toEqual(disable);
  });

  it.each(['verifyMfaSetup', 'checkMfaStatus', 'logout'])(
    'leaves the neighbouring authenticated route %s unthrottled (the amendment stays narrow)',
    (method) => {
      // Only the guard is asserted here: without the decorator no skip metadata
      // is written at all, so there is no kept-set to read back — the absence of
      // the guard IS the property.
      expect(isThrottled(handlerOf(method as keyof typeof AuthController.prototype))).toBe(false);
    },
  );

  it.each(['register', 'login', 'refresh', 'verifyMfa'])(
    'leaves the @Public route %s on its own counters, untouched by this amendment',
    (method) => {
      const handler = handlerOf(method as keyof typeof AuthController.prototype);

      expect(keptCounters(handler).some((name) => name.endsWith('-user'))).toBe(false);
    },
  );
});
