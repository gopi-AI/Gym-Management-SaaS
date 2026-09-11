/**
 * Client-side auth token store.
 *
 * Tokens are kept in `localStorage` so they survive page reloads. This module
 * is safe to import from any component; all access is guarded for SSR where
 * `window` is undefined.
 */

const ACCESS_TOKEN_KEY = 'gym.accessToken';
const REFRESH_TOKEN_KEY = 'gym.refreshToken';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function getAccessToken(): string | null {
  if (!hasStorage()) return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (!hasStorage()) return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(tokens: Partial<TokenPair>): void {
  if (!hasStorage()) return;
  if (tokens.accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  }
  if (tokens.refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }
}

export function clearTokens(): void {
  if (!hasStorage()) return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}