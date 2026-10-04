/**
 * Thin `fetch` wrapper for the Gym Management API.
 *
 * Responsibilities:
 * - Prefix every request with the configured base URL.
 * - Attach the `Authorization: Bearer` header when a token is available.
 * - Attach the `X-Organization-Id` tenant header when an org is selected.
 * - Normalise error responses into an `ApiError`.
 * - Transparently refresh the access token once on a 401 and retry.
 */

import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token-store';
import type { AuthTokens } from './types';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Reads the currently selected organization id (set by the org switcher). */
const ORG_ID_KEY = 'gym.organizationId';

export function getOrganizationId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ORG_ID_KEY);
}

export function setOrganizationId(orgId: string | null): void {
  if (typeof window === 'undefined') return;
  if (orgId) {
    window.localStorage.setItem(ORG_ID_KEY, orgId);
  } else {
    window.localStorage.removeItem(ORG_ID_KEY);
  }
}

/**
 * A failed API call.
 *
 * `status` is not a range that can be used to detect failure:
 * - `0` means the request produced no HTTP response at all — the fetch itself
 *   failed (offline, DNS, connection reset).
 * - A 2xx status can appear here as well, from a refresh response that carried
 *   no usable token pair: the call succeeded, but it could not do its job.
 *
 * Callers must therefore not use range checks such as `status >= 400` to decide
 * whether a call failed — every `ApiError` is a failure whatever its status.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  /**
   * Seconds to wait before retrying, read from the response's `Retry-After`
   * header when the server sent it in delta-seconds form. The throttler sets it
   * on a 429, and a degraded auth backend sets it on the 503 it answers with.
   */
  readonly retryAfter?: number;

  constructor(status: number, message: string, details?: unknown, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip attaching the Authorization header (used by auth endpoints). */
  skipAuth?: boolean;
  /** Skip the automatic refresh-and-retry behavior. */
  skipRefresh?: boolean;
  /** Query string parameters appended to the URL. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Reads `Retry-After` in its delta-seconds form. The HTTP-date form is not
 * parsed, so callers see `undefined` when the server uses it.
 */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isNaN(seconds) || seconds < 0 ? undefined : seconds;
}

async function parseError(res: Response): Promise<ApiError> {
  let details: unknown;
  let message = `Request failed with status ${res.status}`;

  try {
    const data = await res.json();
    details = data;
    if (typeof data?.message === 'string') {
      message = data.message;
    } else if (Array.isArray(data?.message)) {
      message = data.message.join(', ');
    } else if (typeof data?.error === 'string') {
      message = data.error;
    }
  } catch {
    // Non-JSON error body — keep the generic message.
  }

  return new ApiError(res.status, message, details, parseRetryAfter(res));
}

async function performRequest(path: string, options: RequestOptions): Promise<Response> {
  const { body, skipAuth, query, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  if (body !== undefined && !finalHeaders.has('Content-Type')) {
    finalHeaders.set('Content-Type', 'application/json');
  }

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);

    const orgId = getOrganizationId();
    if (orgId) finalHeaders.set('X-Organization-Id', orgId);
  }

  return fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let refreshPromise: Promise<RefreshResult> | null = null;

/**
 * Outcome of an attempt to rotate the access token.
 *
 * - `refreshed` — the backend issued a new pair; the caller retries.
 * - `rejected` — the backend answered 401, i.e. this refresh token is invalid,
 *   expired, revoked or belongs to a gone account. The session is over.
 * - `unavailable` — the backend could not answer at all (5xx, 429, any other
 *   non-OK status, or no response). It never declared the session invalid, so
 *   the tokens are kept and the refresh failure is surfaced instead.
 */
export type RefreshResult =
  | { outcome: 'refreshed' }
  | { outcome: 'rejected' }
  | { outcome: 'unavailable'; error: ApiError };

/** Attempt to rotate the access token using the stored refresh token. */
async function refreshAccessToken(): Promise<RefreshResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    // Nothing to rotate with, and this 401 came from a route that needs a live
    // session — so there is no way back. Clear what is left and let the caller
    // report the original 401: the user is signed out rather than left holding
    // a session that will 401 on every request.
    clearTokens();
    return { outcome: 'rejected' };
  }

  let res: Response;
  try {
    res = await fetch(buildUrl('/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // No HTTP response at all (offline, DNS, connection reset). The server
    // never rejected the token, so the session does not end over this.
    return {
      outcome: 'unavailable',
      error: new ApiError(0, 'Could not reach the server to refresh the session'),
    };
  }

  // 401 is the only status that means "this refresh token is rejected":
  // invalid, expired, revoked, wrong token type, or the account is gone
  // (see AuthService.refreshToken).
  if (res.status === 401) {
    clearTokens();
    return { outcome: 'rejected' };
  }

  // Every other non-OK status means the backend could not answer the question
  // rather than that it answered "no". An outage is not an invalid session:
  // keep the tokens and report the failure that actually happened.
  if (!res.ok) {
    return { outcome: 'unavailable', error: await parseError(res) };
  }

  const malformed = (): RefreshResult => ({
    outcome: 'unavailable',
    error: new ApiError(res.status, 'Malformed response from the refresh endpoint'),
  });

  let tokens: AuthTokens | undefined;
  try {
    tokens = (await res.json()) as AuthTokens;
  } catch {
    return malformed();
  }
  if (!tokens?.accessToken || !tokens?.refreshToken) return malformed();

  setTokens(tokens);
  return { outcome: 'refreshed' };
}

/**
 * Core request helper. Returns the parsed JSON body (or `undefined` for 204).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await performRequest(path, options);

  // Refresh once on an expired access token, then retry the original request.
  if (res.status === 401 && !options.skipAuth && !options.skipRefresh) {
    refreshPromise = refreshPromise ?? refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
    const refresh = await refreshPromise;
    if (refresh.outcome === 'refreshed') {
      res = await performRequest(path, options);
    } else if (refresh.outcome === 'unavailable') {
      // The backend never declared the session invalid, so do not report it as
      // one: surface the refresh failure itself rather than the stale 401 that
      // triggered the refresh. The tokens are still in place, so a later retry
      // can still succeed once the backend recovers.
      throw refresh.error;
    }
    // `rejected` falls through and reports the original 401 below.
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};