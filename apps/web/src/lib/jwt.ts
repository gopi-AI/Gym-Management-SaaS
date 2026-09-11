/**
 * Minimal JWT payload decoder (client-side, no signature verification).
 *
 * Used purely for display — e.g. showing the signed-in user's email. The API
 * remains the sole authority for verifying and authorizing tokens.
 */

export interface JwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
  iat?: number;
  tokenType?: string;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    // base64url → base64
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );

    const json =
      typeof window === 'undefined'
        ? Buffer.from(padded, 'base64').toString('utf-8')
        : decodeURIComponent(
            window
              .atob(padded)
              .split('')
              .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
              .join(''),
          );

    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** Returns true when the token's `exp` claim is in the past. */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJwt(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 <= Date.now();
}