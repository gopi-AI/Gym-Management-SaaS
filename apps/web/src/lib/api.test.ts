/**
 * Token-refresh behaviour of the API client.
 *
 * The defect these tests pin: an expired access token makes the route answer
 * 401, the client refreshes, and the refresh call is the one that reaches the
 * backend's cache. When that call fails for an *infrastructure* reason the
 * session used to be torn down — `refreshAccessToken` treated every `!res.ok`
 * as "your session is invalid", cleared both tokens, and `apiRequest` then
 * reported the stale 401 that had started it all.
 *
 * Only a 401 from the refresh endpoint means "this refresh token is rejected".
 * Everything else means the backend could not answer, and must leave the
 * session alone.
 */

import {
  ApiError,
  API_BASE_URL,
  apiRequest,
} from './api';
import {
  getAccessToken,
  getRefreshToken,
  isAuthenticated,
  setTokens,
} from './token-store';

const REFRESH_URL = `${API_BASE_URL}/v1/auth/refresh`;
const MEMBERS_URL = `${API_BASE_URL}/v1/members`;

const originalFetch = globalThis.fetch;

let fetchMock: jest.Mock;

/** Minimal `localStorage` so `token-store` believes it is in a browser. */
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

/** Seeds the stored session the way a logged-in browser would have it. */
function seedSession(access = 'expired-access', refresh = 'stored-refresh'): void {
  setTokens({ accessToken: access, refreshToken: refresh });
}

function tokens(): { access: string | null; refresh: string | null; authenticated: boolean } {
  return {
    access: getAccessToken(),
    refresh: getRefreshToken(),
    authenticated: isAuthenticated(),
  };
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function reply({ status, body, headers }: Reply): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

/** A scripted step: a response, or an `Error` meaning "the fetch itself failed". */
type Step = Response | Error;

/** Answers the calls in order; an unscripted extra call fails the test loudly. */
function scriptFetch(...steps: Step[]): void {
  let index = 0;
  fetchMock.mockImplementation(() => {
    const step = steps[index++];
    if (step === undefined) {
      return Promise.reject(new Error(`unexpected extra fetch call (#${index})`));
    }
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  });
}

function callsTo(urlFragment: string): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes(urlFragment)).length;
}

/** Awaits a request that must reject, returning the error it rejected with. */
async function failureOf<T>(request: Promise<T>): Promise<ApiError> {
  try {
    await request;
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('expected the request to reject, but it resolved');
}

beforeEach(() => {
  installLocalStorage();
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('refresh accepted', () => {
  it('stores the new pair and retries the original request', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 200, body: { accessToken: 'new-access', refreshToken: 'new-refresh' } }),
      reply({ status: 200, body: { members: [] } }),
    );

    await expect(apiRequest('/v1/members')).resolves.toEqual({ members: [] });

    expect(tokens()).toEqual({
      access: 'new-access',
      refresh: 'new-refresh',
      authenticated: true,
    });
    expect(callsTo('/v1/auth/refresh')).toBe(1);
    expect(callsTo(MEMBERS_URL)).toBe(2);
  });
});

describe('refresh rejected (401 — the token itself is refused)', () => {
  it('clears both tokens and surfaces the original 401', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 401, body: { message: 'Refresh token has been revoked' } }),
    );

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Invalid or expired token');
    expect(tokens()).toEqual({ access: null, refresh: null, authenticated: false });
    // No retry — the retried request would only 401 again.
    expect(callsTo(MEMBERS_URL)).toBe(1);
  });

  it('reports the original 401 without attempting a refresh when no refresh token is stored', async () => {
    setTokens({ accessToken: 'expired-access' });
    scriptFetch(reply({ status: 401, body: { message: 'Invalid or expired token' } }));

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err.status).toBe(401);
    expect(callsTo('/v1/auth/refresh')).toBe(0);
  });
});

describe('refresh unavailable (the backend could not answer)', () => {
  it('keeps the session and reports the 503, not the stale 401', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({
        status: 503,
        body: { message: 'Authentication backend unavailable' },
        headers: { 'Retry-After': '5' },
      }),
    );

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.message).toBe('Authentication backend unavailable');
    expect(err.retryAfter).toBe(5);
    // The whole point: an outage is not an invalid session.
    expect(tokens()).toEqual({
      access: 'expired-access',
      refresh: 'stored-refresh',
      authenticated: true,
    });
    expect(callsTo(MEMBERS_URL)).toBe(1);
  });

  it('keeps the session when the backend throttles the refresh', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({
        status: 429,
        body: { message: 'ThrottlerException: Too Many Requests' },
        headers: { 'Retry-After': '42' },
      }),
    );

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(42);
    expect(tokens().authenticated).toBe(true);
    expect(tokens().refresh).toBe('stored-refresh');
  });

  it('keeps the session on a 5xx that is not a 503', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 500, body: { message: 'Internal server error' } }),
    );

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err.status).toBe(500);
    expect(tokens().authenticated).toBe(true);
  });

  it('keeps the session when a non-401 answer is not a rejection', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 403, body: { message: 'Forbidden' } }),
    );

    const err = await failureOf(apiRequest('/v1/members'));

    // 403 is not in the "rejected" set — only 401 is (AuthService.refreshToken).
    expect(err.status).toBe(403);
    expect(tokens()).toEqual({
      access: 'expired-access',
      refresh: 'stored-refresh',
      authenticated: true,
    });
  });

  it('keeps the session when the refresh request never reaches the server', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      new Error('fetch failed'),
    );

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(tokens()).toEqual({
      access: 'expired-access',
      refresh: 'stored-refresh',
      authenticated: true,
    });
  });

  it('keeps the session when a 200 refresh carries no usable token pair', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 200, body: { unexpected: true } }),
    );

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err.status).toBe(200);
    expect(tokens()).toEqual({
      access: 'expired-access',
      refresh: 'stored-refresh',
      authenticated: true,
    });
  });
});

describe('concurrent 401s', () => {
  it('shares one refresh, gives both callers the same outcome, and resets afterwards', async () => {
    seedSession();
    scriptFetch(
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 503, body: { message: 'Authentication backend unavailable' } }),
      reply({ status: 401, body: { message: 'Invalid or expired token' } }),
      reply({ status: 429, body: { message: 'Too Many Requests' } }),
    );

    const [first, second] = await Promise.all([
      failureOf(apiRequest('/v1/members')),
      failureOf(apiRequest('/v1/members')),
    ]);

    // One refresh for two 401s, and both callers see the same failure.
    expect(callsTo('/v1/auth/refresh')).toBe(1);
    expect(first).toBe(second);
    expect(first.status).toBe(503);

    // The shared promise was cleared, so the next 401 starts a fresh refresh.
    const third = await failureOf(apiRequest('/v1/members'));
    expect(third.status).toBe(429);
    expect(callsTo('/v1/auth/refresh')).toBe(2);
  });
});

describe('a valid access token on an unavailable route', () => {
  it('is unchanged: no refresh is attempted, tokens are kept', async () => {
    seedSession('valid-access', 'stored-refresh');
    scriptFetch(reply({ status: 503, body: { message: 'Service Unavailable' } }));

    const err = await failureOf(apiRequest('/v1/members'));

    expect(err.status).toBe(503);
    expect(callsTo('/v1/auth/refresh')).toBe(0);
    expect(tokens()).toEqual({
      access: 'valid-access',
      refresh: 'stored-refresh',
      authenticated: true,
    });
  });
});
