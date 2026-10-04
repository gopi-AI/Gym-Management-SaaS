import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ServiceUnavailableWithRetryException } from './cache-unavailable.exception';

/**
 * Emits the `Retry-After` header for a `ServiceUnavailableWithRetryException`
 * (owner ruling O1, 2026-10-04) and then answers exactly as Nest would have:
 * `BaseExceptionFilter` builds the standard 503 body, so the status and body
 * shape are unchanged and only the header is added.
 *
 * WHY A FILTER AND NOT `setResponseHeader` AT THE CALL SITE
 * `DefThrottlerGuard` can set the header itself because a guard is handed the
 * response by `ExecutionContext`. The four sites O1 rules on are not all in
 * guards — three are inside `AuthService`, called from a controller — and a
 * service has no response object to set a header on. An exception filter is the
 * only place in the request pipeline that both sees the thrown exception and
 * has the response, and it is the repo's existing mechanism for turning an
 * exception into a response (`SentryGlobalFilter`, `app.module.ts`).
 *
 * REGISTRATION ORDER IS LOAD-BEARING — see `app.module.ts`. This filter is
 * registered AFTER `SentryGlobalFilter`, which reads backwards until you know
 * that Nest REVERSES the filter list before matching (`RouterExceptionFilters
 * .create` → `setCustomFilters(filters.reverse())` in
 * `@nestjs/core/router/router-exception-filters.js`) and then takes the first
 * match (`filters.find(...)` in
 * `@nestjs/common/utils/select-exception-filter-metadata.util.js`). The LAST
 * filter registered is therefore the FIRST one tried, and because
 * `SentryGlobalFilter` is `@Catch()` — it matches every exception — a filter
 * registered before it would never run. Anything that is not a
 * `ServiceUnavailableWithRetryException` still falls through to
 * `SentryGlobalFilter` untouched, exactly as before.
 */
@Catch(ServiceUnavailableWithRetryException)
export class ServiceUnavailableRetryFilter extends BaseExceptionFilter {
  catch(exception: ServiceUnavailableWithRetryException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      setHeader?: (name: string, value: string) => void;
    }>();
    // `setHeader` is absent on a non-HTTP host (and in a bare test double), where
    // there is no header to send; the exception itself still carries the value.
    if (typeof response?.setHeader === 'function') {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    super.catch(exception, host);
  }
}
