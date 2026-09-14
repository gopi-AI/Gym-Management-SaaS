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
import { membershipPlansApi, membershipsApi } from './memberships-api';
import { attendanceApi } from './attendance-api';
import { invoicesApi, paymentsApi } from './finance-api';
import { aiApi } from './ai-api';
import type {
  AiUsageResponse,
  AttendanceAccessDecision,
  AttendanceEventRequest,
  AttendanceEventResult,
  AttendanceRecord,
  Branch,
  CreateBranchRequest,
  CreateInvoiceRequest,
  CreateMemberRequest,
  CreateMembershipPlanRequest,
  CreateMembershipRequest,
  CreateOrganizationRequest,
  Invoice,
  InvoiceDetail,
  InvoiceListItem,
  LifecycleActionRequest,
  ListMembersParams,
  LoginRequest,
  LoginResponse,
  Member,
  Membership,
  MembershipPlan,
  Organization,
  Paginated,
  Payment,
  PlanPerformanceRequest,
  PlanPerformanceResponse,
  QueryAccessDecisionParams,
  QueryAttendanceRecordsParams,
  QueryInvoiceParams,
  QueryMembershipParams,
  QueryMembershipPlanParams,
  QueryPaymentParams,
  RecordPaymentRequest,
  RegisterRequest,
  RegisterResponse,
  RetentionAnalysisRequest,
  RetentionAnalysisResponse,
  TenantSettings,
  UpdateBranchRequest,
  UpdateMemberRequest,
  UpdateMembershipPlanRequest,
  UpdateMembershipRequest,
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
  membershipPlans: {
    all: ['membership-plans'] as const,
    list: (params: QueryMembershipPlanParams) =>
      ['membership-plans', 'list', params] as const,
    detail: (id: string) => ['membership-plans', 'detail', id] as const,
  },
  memberships: {
    all: ['memberships'] as const,
    list: (params: QueryMembershipParams) => ['memberships', 'list', params] as const,
    detail: (id: string) => ['memberships', 'detail', id] as const,
  },
  ai: {
    all: ['ai'] as const,
    retentionAnalysis: (orgId: string, params: RetentionAnalysisRequest) =>
      ['ai', 'retention-analysis', orgId, params] as const,
    planPerformance: (orgId: string, params: PlanPerformanceRequest) =>
      ['ai', 'plan-performance', orgId, params] as const,
    usage: (orgId: string) => ['ai', 'usage', orgId] as const,
  },
  attendance: {
    all: ['attendance'] as const,
    records: (params: QueryAttendanceRecordsParams) =>
      ['attendance', 'records', params] as const,
    record: (id: string) => ['attendance', 'record', id] as const,
    accessDecisions: (params: QueryAccessDecisionParams) =>
      ['attendance', 'access-decisions', params] as const,
  },
  invoices: {
    all: ['invoices'] as const,
    list: (params: QueryInvoiceParams) => ['invoices', 'list', params] as const,
    detail: (id: string) => ['invoices', 'detail', id] as const,
  },
  payments: {
    all: ['payments'] as const,
    list: (params: QueryPaymentParams) => ['payments', 'list', params] as const,
    detail: (id: string) => ['payments', 'detail', id] as const,
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

/* ── Membership Plans ────────────────────────────────────────────────── */

export function useMembershipPlans(
  params: QueryMembershipPlanParams = {},
  options?: Omit<UseQueryOptions<Paginated<MembershipPlan>, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Paginated<MembershipPlan>, Error>({
    queryKey: queryKeys.membershipPlans.list(params),
    queryFn: () => membershipPlansApi.list(params),
    ...options,
  });
}

export function useMembershipPlan(
  id: string,
  options?: Omit<UseQueryOptions<MembershipPlan, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<MembershipPlan, Error>({
    queryKey: queryKeys.membershipPlans.detail(id),
    queryFn: () => membershipPlansApi.get(id),
    enabled: !!id,
    ...options,
  });
}

export function useCreateMembershipPlan(
  options?: UseMutationOptions<MembershipPlan, Error, CreateMembershipPlanRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<MembershipPlan, Error, CreateMembershipPlanRequest>({
    mutationFn: (payload) => membershipPlansApi.create(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.membershipPlans.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateMembershipPlan(
  options?: UseMutationOptions<
    MembershipPlan,
    Error,
    { id: string; payload: UpdateMembershipPlanRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    MembershipPlan,
    Error,
    { id: string; payload: UpdateMembershipPlanRequest }
  >({
    mutationFn: ({ id, payload }) => membershipPlansApi.update(id, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.membershipPlans.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.membershipPlans.detail(variables.id),
      });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/* ── Memberships ─────────────────────────────────────────────────────── */

export function useMemberships(
  params: QueryMembershipParams = {},
  options?: Omit<UseQueryOptions<Paginated<Membership>, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Paginated<Membership>, Error>({
    queryKey: queryKeys.memberships.list(params),
    queryFn: () => membershipsApi.list(params),
    ...options,
  });
}

export function useMembership(
  id: string,
  options?: Omit<UseQueryOptions<Membership, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Membership, Error>({
    queryKey: queryKeys.memberships.detail(id),
    queryFn: () => membershipsApi.get(id),
    enabled: !!id,
    ...options,
  });
}

export function useCreateMembership(
  options?: UseMutationOptions<Membership, Error, CreateMembershipRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<Membership, Error, CreateMembershipRequest>({
    mutationFn: (payload) => membershipsApi.create(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memberships.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateMembership(
  options?: UseMutationOptions<
    Membership,
    Error,
    { id: string; payload: UpdateMembershipRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<Membership, Error, { id: string; payload: UpdateMembershipRequest }>({
    mutationFn: ({ id, payload }) => membershipsApi.update(id, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memberships.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.memberships.detail(variables.id),
      });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Generic lifecycle mutation hook for memberships.
 * Supports: pause, resume, freeze, unfreeze, cancel.
 */
export function useMembershipLifecycleAction(
  options?: UseMutationOptions<
    Membership,
    Error,
    { id: string; action: string; payload?: LifecycleActionRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    Membership,
    Error,
    { id: string; action: string; payload?: LifecycleActionRequest }
  >({
    mutationFn: ({ id, action, payload }) => {
      switch (action) {
        case 'pause': return membershipsApi.pause(id, payload);
        case 'resume': return membershipsApi.resume(id, payload);
        case 'freeze': return membershipsApi.freeze(id, payload);
        case 'unfreeze': return membershipsApi.unfreeze(id, payload);
        case 'cancel': return membershipsApi.cancel(id, payload);
        default: throw new Error(`Unknown lifecycle action: ${action}`);
      }
    },
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memberships.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.memberships.detail(variables.id),
      });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/* ── AI ──────────────────────────────────────────────────────────────── */

/**
 * Runs an organization-scoped retention analysis.
 *
 * Modelled as a mutation rather than a query: each call triggers billable AI
 * processing, so it must only ever run from an explicit user action — never on
 * render, and never on a background refetch.
 */
export function useRetentionAnalysis(
  options?: UseMutationOptions<
    RetentionAnalysisResponse,
    Error,
    { orgId: string; payload: RetentionAnalysisRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    RetentionAnalysisResponse,
    Error,
    { orgId: string; payload: RetentionAnalysisRequest }
  >({
    mutationFn: ({ orgId, payload }) => aiApi.retentionAnalysis(orgId, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      // Cache the result so the page (or a later usage view) can re-read it
      // without paying for another provider call.
      queryClient.setQueryData(
        queryKeys.ai.retentionAnalysis(variables.orgId, variables.payload),
        data,
      );
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/**
 * Runs an organization-scoped membership-plan performance analysis.
 *
 * Modelled as a mutation rather than a query for the same reason as the
 * retention analysis: each call triggers billable AI processing, so it must
 * only ever run from an explicit user action — never on render, and never on a
 * background refetch.
 */
export function usePlanPerformanceAnalysis(
  options?: UseMutationOptions<
    PlanPerformanceResponse,
    Error,
    { orgId: string; payload: PlanPerformanceRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    PlanPerformanceResponse,
    Error,
    { orgId: string; payload: PlanPerformanceRequest }
  >({
    mutationFn: ({ orgId, payload }) => aiApi.planPerformance(orgId, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.setQueryData(
        queryKeys.ai.planPerformance(variables.orgId, variables.payload),
        data,
      );
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}


/**
 * Organization-scoped AI usage/cost summary for operators.
 *
 * Modelled as a QUERY (not a mutation) because it is a free, read-only read of
 * already-recorded telemetry: it never calls the provider and therefore cannot
 * spend budget. It is only fetched when an organization is selected.
 */
export function useAiUsage(
  orgId: string | null,
  options?: Omit<UseQueryOptions<AiUsageResponse, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<AiUsageResponse, Error>({
    ...options,
    queryKey: queryKeys.ai.usage(orgId ?? ''),
    queryFn: () => aiApi.usage(orgId as string),
    enabled: Boolean(orgId) && (options?.enabled ?? true),
  });
}

/* ── Attendance ────────────────────────────────────────────────────────── */

export function useAttendanceRecords(
  params: QueryAttendanceRecordsParams = {},
  options?: Omit<UseQueryOptions<Paginated<AttendanceRecord>, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Paginated<AttendanceRecord>, Error>({
    queryKey: queryKeys.attendance.records(params),
    queryFn: () => attendanceApi.listRecords(params),
    ...options,
  });
}

export function useAttendanceRecord(
  id: string,
  options?: Omit<UseQueryOptions<AttendanceRecord, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<AttendanceRecord, Error>({
    queryKey: queryKeys.attendance.record(id),
    queryFn: () => attendanceApi.getRecord(id),
    enabled: Boolean(id) && (options?.enabled ?? true),
    ...options,
  });
}

export function useAccessDecisions(
  params: QueryAccessDecisionParams = {},
  options?: Omit<
    UseQueryOptions<Paginated<AttendanceAccessDecision>, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<Paginated<AttendanceAccessDecision>, Error>({
    queryKey: queryKeys.attendance.accessDecisions(params),
    queryFn: () => attendanceApi.listAccessDecisions(params),
    ...options,
  });
}

/**
 * Check a member in.
 *
 * A refused check-in rejects with an `ApiError` (403) whose details carry the
 * machine-readable `reason` — the desk can then show "membership paused" etc.
 * The attendance queries are invalidated either way, because a refusal also
 * writes an access-decision audit row.
 */
export function useCheckIn(
  options?: UseMutationOptions<AttendanceEventResult, Error, AttendanceEventRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<AttendanceEventResult, Error, AttendanceEventRequest>({
    mutationFn: (payload) => attendanceApi.checkIn(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useCheckOut(
  options?: UseMutationOptions<AttendanceEventResult, Error, AttendanceEventRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<AttendanceEventResult, Error, AttendanceEventRequest>({
    mutationFn: (payload) => attendanceApi.checkOut(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

/* ── Finance ───────────────────────────────────────────────────────────── */

export function useInvoices(
  params: QueryInvoiceParams = {},
  options?: Omit<
    UseQueryOptions<Paginated<InvoiceListItem>, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<Paginated<InvoiceListItem>, Error>({
    queryKey: queryKeys.invoices.list(params),
    queryFn: () => invoicesApi.list(params),
    ...options,
  });
}

export function useInvoice(
  id: string,
  options?: Omit<UseQueryOptions<InvoiceDetail, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<InvoiceDetail, Error>({
    queryKey: queryKeys.invoices.detail(id),
    queryFn: () => invoicesApi.get(id),
    enabled: Boolean(id) && (options?.enabled ?? true),
    ...options,
  });
}

export function useCreateInvoice(
  options?: UseMutationOptions<InvoiceDetail, Error, CreateInvoiceRequest>,
) {
  const queryClient = useQueryClient();
  return useMutation<InvoiceDetail, Error, CreateInvoiceRequest>({
    mutationFn: (payload) => invoicesApi.create(payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useVoidInvoice(options?: UseMutationOptions<Invoice, Error, string>) {
  const queryClient = useQueryClient();
  return useMutation<Invoice, Error, string>({
    mutationFn: (id) => invoicesApi.void(id),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables) });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function usePayments(
  params: QueryPaymentParams = {},
  options?: Omit<UseQueryOptions<Paginated<Payment>, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Paginated<Payment>, Error>({
    queryKey: queryKeys.payments.list(params),
    queryFn: () => paymentsApi.list(params),
    ...options,
  });
}

/**
 * Record a payment against an invoice.
 *
 * Recording money also moves the invoice status (partially_paid / paid), so both
 * the payment and the invoice queries are invalidated.
 */
export function useRecordPayment(
  options?: UseMutationOptions<
    Payment,
    Error,
    { invoiceId: string; payload: RecordPaymentRequest }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<Payment, Error, { invoiceId: string; payload: RecordPaymentRequest }>({
    mutationFn: ({ invoiceId, payload }) => paymentsApi.record(invoiceId, payload),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.invoiceId) });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

