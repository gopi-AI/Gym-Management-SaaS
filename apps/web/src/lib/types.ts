/**
 * Shared client-side types for the Gym Management API.
 *
 * These mirror the response shapes of the NestJS backend. Assertions in this
 * file are intentionally limited to field names the API actually returns.
 */

/* ── Auth ──────────────────────────────────────────────────────────────── */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  mfaRequired?: boolean;
  challenge?: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  is_active?: boolean;
  email_verified?: boolean;
  is_mfa_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface VerifyMfaRequest {
  challengeToken: string;
  otpCode: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/* ── Members ───────────────────────────────────────────────────────────── */

export interface Member {
  id: string;
  organization_id: string;
  branch_id: string;
  global_uuid: string;
  local_id: number;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  preferred_name?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface CreateMemberRequest {
  first_name: string;
  last_name: string;
  middle_name?: string;
  preferred_name?: string;
  date_of_birth?: string;
  gender?: string;
  phone?: string;
  email?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  branch_id?: string;
}

export type UpdateMemberRequest = Partial<CreateMemberRequest>;

export interface ListMembersParams {
  page?: number;
  limit?: number;
  search?: string;
  branch_id?: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/* ── Organizations / branches / settings ───────────────────────────────── */

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  currency: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface CreateOrganizationRequest {
  name: string;
  timezone?: string;
  locale?: string;
  currency?: string;
}

export type UpdateOrganizationRequest = Partial<CreateOrganizationRequest>;

export interface Branch {
  id: string;
  organization_id: string;
  name: string;
  address: string;
  phone: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface CreateBranchRequest {
  name: string;
  address?: string;
  phone?: string;
}

export type UpdateBranchRequest = Partial<CreateBranchRequest>;

export interface TenantSettings {
  id: string;
  organization_id: string;
  time_zone: string;
  locale: string;
  currency: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface UpdateTenantSettingsRequest {
  time_zone?: string;
  locale?: string;
  currency?: string;
}