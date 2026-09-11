/**
 * Auth API endpoints (all public / pre-token).
 */

import { api } from './api';
import { clearTokens, setTokens } from './token-store';
import type {
  AuthTokens,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  VerifyMfaRequest,
} from './types';

export const authApi = {
  login: (payload: LoginRequest) =>
    api.post<LoginResponse>('/v1/auth/login', payload, { skipAuth: true }),

  register: (payload: RegisterRequest) =>
    api.post<RegisterResponse>('/v1/auth/register', payload, { skipAuth: true }),

  refresh: (refreshToken: string) =>
    api.post<AuthTokens>(
      '/v1/auth/refresh',
      { refreshToken },
      { skipAuth: true, skipRefresh: true },
    ),

  verifyMfa: (payload: VerifyMfaRequest) =>
    api.post<AuthTokens>('/v1/auth/verify-mfa', payload, { skipAuth: true }),

  logout: async (refreshToken?: string) => {
    try {
      return await api.post<{ success: boolean }>('/v1/auth/logout', {
        refreshToken,
      });
    } finally {
      clearTokens();
    }
  },
};

/**
 * Persist the token pair returned by login / verify-mfa so subsequent API
 * calls are authenticated.
 */
export function persistSession(tokens: AuthTokens): void {
  setTokens(tokens);
}