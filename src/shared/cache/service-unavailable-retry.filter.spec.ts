/**
 * Owner ruling O1 (2026-10-04): an infrastructure failure answers
 * `503 Service Unavailable` WITH a `Retry-After` header.
 *
 * WHY THIS IS AN HTTP TEST AND NOT A UNIT TEST
 * The ruling is about what a CLIENT receives, and "the exception carries
 * `retryAfterSeconds`" does not prove a header was ever written to a socket. So
 * this file stands up a real Nest application on a real port and reads the
 * response with `fetch` — no new dependency, and no mock anywhere in the header
 * path.
 *
 * WHAT IT PINS THAT A UNIT TEST CANNOT
 * Nest REVERSES the filter list before matching (`RouterExceptionFilters.create`
 * → `setCustomFilters(filters.reverse())` in
 * `@nestjs/core/router/router-exception-filters.js`) and then takes the first
 * match (`filters.find(...)` in
 * `@nestjs/common/utils/select-exception-filter-metadata.util.js`), so the LAST
 * filter registered is the FIRST one tried. `SentryGlobalFilter` is `@Catch()`
 * — it matches every exception — so if this filter were registered BEFORE it,
 * this filter would never run and the `Retry-After` header would silently never
 * be sent. That was measured, not assumed: with the two providers in the wrong
 * order this spec failed with `retry-after: null` on a 503 whose body looked
 * perfectly correct. The module below reproduces the production ORDER from
 * `app.module.ts` exactly and uses the real `SentryGlobalFilter`, so the
 * ordering is exercised rather than assumed: `/probe/unavailable` gains its
 * header, and `/probe/boom` still gets Sentry's normal answer with no header.
 *
 * SCOPE — what this does NOT cover: the full `AppModule` (it needs Postgres and
 * Redis) is not booted here. That the two filters wire into `AppModule` at all
 * is covered by `src/app.boot.spec.ts`, which compiles the real module.
 */
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import {
  CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  ServiceUnavailableWithRetryException,
} from './cache-unavailable.exception';
import { ServiceUnavailableRetryFilter } from './service-unavailable-retry.filter';

/** The message the auth call sites throw — must not name Redis or a token. */
const AUTH_UNAVAILABLE_MESSAGE = 'Authentication backend unavailable';

@Controller('probe')
class ProbeController {
  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableWithRetryException(AUTH_UNAVAILABLE_MESSAGE);
  }

  @Get('unavailable-custom-retry')
  customRetry(): never {
    throw new ServiceUnavailableWithRetryException(AUTH_UNAVAILABLE_MESSAGE, 12);
  }

  /** Not our exception: must fall through to SentryGlobalFilter untouched. */
  @Get('boom')
  boom(): never {
    throw new Error('an unrelated failure');
  }
}

@Module({
  controllers: [ProbeController],
  providers: [
    // ORDER MATTERS — same order as `app.module.ts`, where the LAST registered
    // filter is the FIRST one tried. See the file comment.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_FILTER, useClass: ServiceUnavailableRetryFilter },
  ],
})
class ProbeModule {}

describe('ServiceUnavailableRetryFilter — the 503 actually carries Retry-After (O1)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 503 with a Retry-After header over real HTTP', async () => {
    const response = await fetch(`${baseUrl}/probe/unavailable`);

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe(
      String(CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS),
    );
    // The body is Nest's standard exception body — the filter adds a header and
    // changes nothing else. `BaseExceptionFilter` produced this, not a bespoke
    // response shape.
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 503,
      message: AUTH_UNAVAILABLE_MESSAGE,
    });
  });

  it('sends the value the exception carries, not a hard-coded one', async () => {
    const response = await fetch(`${baseUrl}/probe/unavailable-custom-retry`);

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('12');
  });

  it('leaves every other exception to SentryGlobalFilter, with no Retry-After', async () => {
    // Registered after this filter, SentryGlobalFilter is `@Catch()`: if the
    // ordering were backwards this route would lose its normal answer and this
    // filter would never have run on the route above either.
    const response = await fetch(`${baseUrl}/probe/boom`);

    expect(response.status).toBe(500);
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('is not a 401, so the web client does not treat an outage as a bad session', async () => {
    // `apps/web/src/lib/api.ts:151` refreshes-and-retries only on 401; answering
    // 401 here is what made a Redis outage sign the user out.
    const response = await fetch(`${baseUrl}/probe/unavailable`);

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(503);
  });
});
