/**
 * Tenancy API endpoints: organizations, branches and tenant settings.
 */

import { api } from './api';
import type {
  Branch,
  CreateBranchRequest,
  CreateOrganizationRequest,
  Organization,
  TenantSettings,
  UpdateBranchRequest,
  UpdateOrganizationRequest,
  UpdateTenantSettingsRequest,
} from './types';

export const organizationsApi = {
  list: () => api.get<Organization[]>('/v1/organizations'),
  get: (id: string) => api.get<Organization>(`/v1/organizations/${id}`),
  create: (payload: CreateOrganizationRequest) =>
    api.post<Organization>('/v1/organizations', payload),
  update: (id: string, payload: UpdateOrganizationRequest) =>
    api.patch<Organization>(`/v1/organizations/${id}`, payload),
};

export const branchesApi = {
  list: () => api.get<Branch[]>('/v1/branches'),
  get: (id: string) => api.get<Branch>(`/v1/branches/${id}`),
  create: (payload: CreateBranchRequest) =>
    api.post<Branch>('/v1/branches', payload),
  update: (id: string, payload: UpdateBranchRequest) =>
    api.patch<Branch>(`/v1/branches/${id}`, payload),
};

export const tenantSettingsApi = {
  get: (orgId: string) =>
    api.get<TenantSettings>(`/v1/organizations/${orgId}/tenant-settings`),
  create: (orgId: string, payload: UpdateTenantSettingsRequest) =>
    api.post<TenantSettings>(`/v1/organizations/${orgId}/tenant-settings`, payload),
  update: (orgId: string, payload: UpdateTenantSettingsRequest) =>
    api.patch<TenantSettings>(`/v1/organizations/${orgId}/tenant-settings`, payload),
};