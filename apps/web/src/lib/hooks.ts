/**
 * React Query hooks for the Gym Management API.
 *
 * Query keys are namespaced so mutations can invalidate exactly the queries
 * that go stale.
 */

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { authApi } from './auth-api';
import { branchesApi, organizationsApi, tenantSettingsApi } from './tenancy-api';
import { membersApi } from './members-api';
import type {
  Branch,
  CreateBranchRequest,
  CreateMemberRequest,
  CreateOrganizationRequest,
  ListMembersParams,
  LoginRequest,
  LoginResponse,
  Member,
  Organization,
  Paginated,
  RegisterRequest,
  RegisterResponse,
  TenantSettings,
  UpdateBranchRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateTenantSettingsRequest,
  VerifyMfaRequest,
  AuthTokens,
} from './types';

export const queryKeys = {
  members: {
    all: ['members'] as const,
    list: (params: ListMembersParams) => ['members', 'list', params] as const,
    detail: (id: string) => ['members', 'detail', id] as const,
  },
  organizations: {
    all: ['organizations'] as const,
    detail: (id: string) => ['organizations', 'detail', id] as const,
  },
  branches: {
    all: ['branches'] as const,
    detail: (id: string) => ['branches', 'detail', id] as const,
  },
  tenantSettings: {
    detail: (orgId: string) => ['tenant-settings', orgId] as const,
  },
};

/* ── Auth ──────────────────────────────────────────────────────────────── */

export function useLogin(
  options?: UseMutationOptions<LoginResponse, Error, LoginRequest>,
) {
  return useMutation<LoginResponse, Error, LoginRequest>({
    mutationFn: (payload) => authApi.login(payload),
    ...options,
  });
}

export function useRegister(
  options?: UseMutationOptions<RegisterResponse, Error, RegisterRequest>,
) {
  return useMutation<RegisterResponse, Error, RegisterRequest>({
    mutationFn: (payload) => authApi.register(payload),
    ...options,
  });
}

export function useVerifyMfa(
  options?: UseMutationOptions<AuthTokens, Error, VerifyMfaRequest>,
) {
  return useMutation<AuthTokens, Error, VerifyMfaRequest>({
    mutationFn: (payload) => authApi.verifyMfa(payload),
    ...options,
  });
}

/* ── Members ───────────────────────────────────────────────────────────── */

export function useMembers(
  params: ListMembersParams = {},
  options?: Omit<UseQueryOptions<Paginated<Member>, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Paginated<Member>, Error>({
    queryKey: queryKeys.members.list(params),
    queryFn: () => membersApi.list(params),
    ...options,
  });
}

export function useMember(
  id: string,
  options?: Omit<UseQueryOptions<Member, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Member, Error>({
    queryKey: queryKeys.members.detail(id),
    queryFn: () => membersApi.get(id),
    enabled: !!id,
    ...options,
  });
}

export function useCreateMember(
  options?: UseMutationOptions<Member, Error, CreateMemberRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<Member, Error, CreateMemberRequest>({
    mutationFn: (payload) => membersApi.create(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateMember(
  options?: UseMutationOptions<
    Member,
    Error,
    { id: string; payload: UpdateMemberRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<Member, Error, { id: string; payload: UpdateMemberRequest }>({
    mutationFn: ({ id, payload }) => membersApi.update(id, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.members.detail(variables.id),
      });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/* ── Organizations ─────────────────────────────────────────────────────── */

export function useOrganizations(
  options?: Omit<UseQueryOptions<Organization[], Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Organization[], Error>({
    queryKey: queryKeys.organizations.all,
    queryFn: () => organizationsApi.list(),
    ...options,
  });
}

export function useCreateOrganization(
  options?: UseMutationOptions<Organization, Error, CreateOrganizationRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<Organization, Error, CreateOrganizationRequest>({
    mutationFn: (payload) => organizationsApi.create(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateOrganization(
  options?: UseMutationOptions<
    Organization,
    Error,
    { id: string; payload: UpdateOrganizationRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    Organization,
    Error,
    { id: string; payload: UpdateOrganizationRequest }
  >({
    mutationFn: ({ id, payload }) => organizationsApi.update(id, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/* ── Branches ──────────────────────────────────────────────────────────── */

export function useBranches(
  options?: Omit<UseQueryOptions<Branch[], Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Branch[], Error>({
    queryKey: queryKeys.branches.all,
    queryFn: () => branchesApi.list(),
    ...options,
  });
}

export function useCreateBranch(
  options?: UseMutationOptions<Branch, Error, CreateBranchRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<Branch, Error, CreateBranchRequest>({
    mutationFn: (payload) => branchesApi.create(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.branches.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateBranch(
  options?: UseMutationOptions<
    Branch,
    Error,
    { id: string; payload: UpdateBranchRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<Branch, Error, { id: string; payload: UpdateBranchRequest }>({
    mutationFn: ({ id, payload }) => branchesApi.update(id, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.branches.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/* ── Tenant settings ───────────────────────────────────────────────────── */

export function useTenantSettings(
  orgId: string,
  options?: Omit<UseQueryOptions<TenantSettings, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<TenantSettings, Error>({
    queryKey: queryKeys.tenantSettings.detail(orgId),
    queryFn: () => tenantSettingsApi.get(orgId),
    enabled: !!orgId,
    ...options,
  });
}

export function useUpdateTenantSettings(
  options?: UseMutationOptions<
    TenantSettings,
    Error,
    { orgId: string; payload: UpdateTenantSettingsRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    TenantSettings,
    Error,
    { orgId: string; payload: UpdateTenantSettingsRequest }
  >({
    mutationFn: ({ orgId, payload }) => tenantSettingsApi.update(orgId, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tenantSettings.detail(variables.orgId),
      });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}
