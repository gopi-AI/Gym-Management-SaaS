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

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
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

  return new ApiError(res.status, message, details);
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

let refreshPromise: Promise<boolean> | null = null;

/** Attempt to rotate the access token using the stored refresh token. */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(buildUrl('/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    const tokens = (await res.json()) as AuthTokens;
    setTokens(tokens);
    return true;
  } catch {
    clearTokens();
    return false;
  }
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
    const refreshed = await refreshPromise;
    if (refreshed) {
      res = await performRequest(path, options);
    }
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