import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AppModule } from '../../app.module';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { DefThrottlerGuard } from './def-throttler.guard';

/**
 * DEF-07 structural coverage: EVERY `@Public()` route must be throttled by
 * `DefThrottlerGuard` or on an explicit exempt list that contains only
 * `GET /v1/health`.
 *
 * HOW THE ROUTES ARE ENUMERATED — from Nest's own metadata, never a hand-written
 * list. The module graph is walked from `AppModule` through
 * `MODULE_METADATA.IMPORTS` (following dynamic-module objects and `forwardRef`),
 * every `controllers` entry of each module is collected, and a prototype method
 * carries a route when it has `PATH_METADATA` + `METHOD_METADATA`. `@Public()` is
 * read with the application's own `IS_PUBLIC_KEY`, and "throttled" means
 * `DefThrottlerGuard` is in the handler's (or the controller's)
 * `GUARDS_METADATA`.
 *
 * WHY IT CANNOT SILENTLY MISS A CONTROLLER — the walk is the same graph Nest
 * builds the HTTP surface from, so a controller that answers requests is in it.
 * The test additionally pins the six known public routes, so a controller that
 * somehow left the graph fails this spec instead of quietly shrinking it.
 */
type AnyType = abstract new (...args: never[]) => unknown;

interface PublicRoute {
  controller: string;
  method: string;
  path: string;
  throttled: boolean;
}

/** The only unauthenticated route allowed to run without a throttler (Q10). */
const EXEMPT: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/v1/health' },
];

const label = (route: { method: string; path: string }) => `${route.method} ${route.path}`;

const isExempt = (route: { method: string; path: string }) =>
  EXEMPT.some((exempt) => exempt.method === route.method && exempt.path === route.path);

const joinPath = (...parts: string[]) =>
  `/${parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;

const toPathList = (value: unknown): string[] =>
  value === undefined ? [''] : Array.isArray(value) ? value.map(String) : [String(value)];

function collectControllers(): AnyType[] {
  const controllers: AnyType[] = [];
  const seenModules = new Set<unknown>();

  const visitModule = (moduleType: AnyType): void => {
    if (seenModules.has(moduleType)) return;
    seenModules.add(moduleType);
    for (const controller of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleType) ?? []) {
      controllers.push(controller as AnyType);
    }
    for (const imported of Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ?? []) {
      visitEntry(imported);
    }
  };

  const visitEntry = (entry: unknown): void => {
    if (entry === null || entry === undefined) return;
    if (typeof entry === 'function') {
      visitModule(entry as AnyType);
      return;
    }
    if (typeof entry === 'object') {
      const dynamic = entry as { module?: unknown; forwardRef?: () => unknown };
      if (typeof dynamic.forwardRef === 'function') visitEntry(dynamic.forwardRef());
      else if (dynamic.module) visitEntry(dynamic.module);
    }
  };

  visitModule(AppModule as unknown as AnyType);
  return controllers;
}

function collectPublicRoutes(): PublicRoute[] {
  const routes: PublicRoute[] = [];

  for (const controller of collectControllers()) {
    const classPath = Reflect.getMetadata(PATH_METADATA, controller);
    const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
    const classIsPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
    const prototype = (controller as unknown as { prototype?: object }).prototype;
    if (!prototype) continue;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const methodMetadata = Reflect.getMetadata(METHOD_METADATA, handler);
      if (methodMetadata === undefined) continue; // not a route handler

      const isPublic = classIsPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
      if (!isPublic) continue;

      const handlerGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
      const throttled = [...classGuards, ...handlerGuards].includes(DefThrottlerGuard);
      const handlerPath = Reflect.getMetadata(PATH_METADATA, handler);

      for (const classPart of toPathList(classPath)) {
        for (const handlerPart of toPathList(handlerPath)) {
          routes.push({
            controller: controller.name,
            method: RequestMethod[methodMetadata],
            path: joinPath(classPart, handlerPart),
            throttled,
          });
        }
      }
    }
  }

  return routes;
}

describe('@Public route coverage (DEF-07 structural guard)', () => {
  const routes = collectPublicRoutes();

  it('enumerates the six known public routes, so a controller cannot silently leave the graph', () => {
    expect(routes.map(label)).toEqual(
      expect.arrayContaining([
        'POST /v1/auth/register',
        'POST /v1/auth/login',
        'POST /v1/auth/refresh',
        'POST /v1/auth/verify-mfa',
        'POST /v1/webhooks/payment-gateway',
        'GET /v1/health',
      ]),
    );
  });

  it('exempts exactly one route: GET /v1/health', () => {
    expect(EXEMPT.map(label)).toEqual(['GET /v1/health']);
  });

  it('throttles every @Public route that is not exempt', () => {
    const uncovered = routes.filter((route) => !route.throttled && !isExempt(route)).map(label);

    // Thrown rather than asserted so the failure message always NAMES the
    // offending route(s) as "METHOD /path"; the assertion below then documents
    // the expected state for the passing case.
    if (uncovered.length > 0) {
      throw new Error(
        `@Public route(s) neither throttled by DefThrottlerGuard nor on the exempt list: ${uncovered.join('; ')}`,
      );
    }
    expect(uncovered).toEqual([]);
  });

  it('leaves the exempt route free of the guard (the exemption is by construction)', () => {
    const health = routes.find((route) => label(route) === 'GET /v1/health');

    expect(health).toBeDefined();
    expect(health?.throttled).toBe(false);
  });
});
