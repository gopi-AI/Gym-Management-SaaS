import { ServiceUnavailableException } from '@nestjs/common';

/**
 * The HTTP answer to an infrastructure failure on a request-path cache call
 * (owner ruling O1, 2026-10-04).
 *
 * O1: "Use 503 Service Unavailable with Retry-After, not 401, for infrastructure
 * timeouts: Guard blacklist read, Refresh blacklist read, MFA replay claim,
 * Blacklist writes. Keep the authentication path fail-closed, but do not
 * represent a Redis infrastructure failure to the web client as an invalid user
 * session."
 *
 * WHY A SUBCLASS RATHER THAN A PLAIN `ServiceUnavailableException`
 * The service is genuinely unavailable, but it is not PERMANENTLY unavailable —
 * it is a cache outage that clears on its own, and the client should come back
 * rather than treat the account as broken. Carrying `retryAfterSeconds` lets one
 * filter add the header without every call site reaching for the response
 * object, which a service has no access to.
 *
 * This is deliberately NOT `UnauthorizedException`: a 401 makes the web client
 * treat the session as invalid. `apps/web/src/lib/api.ts:151` runs its
 * refresh-and-retry only on a 401, and `refreshAccessToken` clears the tokens
 * when the refresh it triggers fails (`:130-133`). Answering 401 for an outage
 * therefore signs the user out; a 503 is thrown to the caller as an
 * `ApiError(503)` with the tokens untouched.
 *
 * A genuine revocation answer stays a 401 and never comes through here.
 */
/**
 * RECOMMENDATION, not an owner ruling: O1 ruled that a `Retry-After` header is
 * sent but did not fix its value. 5 seconds is chosen to be longer than the
 * 500 ms default deadline — so a client that honours it has outlasted a
 * transient blip — while staying short enough not to park a UI for long. The
 * 429 throttler header uses the same unit (seconds) and is built from the
 * window that actually blocked the request, so the two agree in form.
 *
 * Seconds, as `Retry-After` requires.
 */
export const CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

export class ServiceUnavailableWithRetryException extends ServiceUnavailableException {
  /** Seconds a client should wait before retrying — see the constant above. */
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number = CACHE_UNAVAILABLE_RETRY_AFTER_SECONDS) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
