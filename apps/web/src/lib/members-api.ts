/**
 * Members API endpoints.
 */

import { api } from './api';
import type {
  CreateMemberRequest,
  ListMembersParams,
  Member,
  Paginated,
  UpdateMemberRequest,
} from './types';

export const membersApi = {
  list: (params: ListMembersParams = {}) =>
    api.get<Paginated<Member>>('/v1/members', {
      query: {
        page: params.page,
        limit: params.limit,
        search: params.search,
        branch_id: params.branch_id,
      },
    }),

  get: (id: string) => api.get<Member>(`/v1/members/${id}`),

  create: (payload: CreateMemberRequest) =>
    api.post<Member>('/v1/members', payload),

  update: (id: string, payload: UpdateMemberRequest) =>
    api.patch<Member>(`/v1/members/${id}`, payload),
};