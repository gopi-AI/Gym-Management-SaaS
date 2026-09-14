/**
 * Memberships & Membership Plans API endpoints.
 *
 * Mirrors the backend controllers:
 *   - MembershipPlansController  @Controller('v1/membership-plans')
 *   - MembershipsController      @Controller('v1/memberships')
 */

import { api } from './api';
import type {
  Membership,
  MembershipPlan,
  CreateMembershipPlanRequest,
  CreateMembershipRequest,
  LifecycleActionRequest,
  Paginated,
  QueryMembershipParams,
  QueryMembershipPlanParams,
  UpdateMembershipPlanRequest,
  UpdateMembershipRequest,
} from './types';

export const membershipPlansApi = {
  list: (params: QueryMembershipPlanParams = {}) =>
    api.get<Paginated<MembershipPlan>>('/v1/membership-plans', {
      query: {
        page: params.page,
        limit: params.limit,
        is_active: params.is_active,
      },
    }),

  get: (id: string) => api.get<MembershipPlan>(`/v1/membership-plans/${id}`),

  create: (payload: CreateMembershipPlanRequest) =>
    api.post<MembershipPlan>('/v1/membership-plans', payload),

  update: (id: string, payload: UpdateMembershipPlanRequest) =>
    api.patch<MembershipPlan>(`/v1/membership-plans/${id}`, payload),
};

export const membershipsApi = {
  list: (params: QueryMembershipParams = {}) =>
    api.get<Paginated<Membership>>('/v1/memberships', {
      query: {
        page: params.page,
        limit: params.limit,
        status: params.status,
        plan_id: params.plan_id,
        branch_id: params.branch_id,
        member_id: params.member_id,
      },
    }),

  get: (id: string) => api.get<Membership>(`/v1/memberships/${id}`),

  findByMember: (memberId: string, params: QueryMembershipParams = {}) =>
    api.get<Paginated<Membership>>(`/v1/memberships/member/${memberId}`, {
      query: {
        page: params.page,
        limit: params.limit,
        status: params.status,
      },
    }),

  create: (payload: CreateMembershipRequest) =>
    api.post<Membership>('/v1/memberships', payload),

  update: (id: string, payload: UpdateMembershipRequest) =>
    api.patch<Membership>(`/v1/memberships/${id}`, payload),

  pause: (id: string, payload?: LifecycleActionRequest) =>
    api.post<Membership>(`/v1/memberships/${id}/pause`, payload),

  resume: (id: string, payload?: LifecycleActionRequest) =>
    api.post<Membership>(`/v1/memberships/${id}/resume`, payload),

  freeze: (id: string, payload?: LifecycleActionRequest) =>
    api.post<Membership>(`/v1/memberships/${id}/freeze`, payload),

  unfreeze: (id: string, payload?: LifecycleActionRequest) =>
    api.post<Membership>(`/v1/memberships/${id}/unfreeze`, payload),

  cancel: (id: string, payload?: LifecycleActionRequest) =>
    api.post<Membership>(`/v1/memberships/${id}/cancel`, payload),
};