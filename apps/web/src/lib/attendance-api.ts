/**
 * Attendance API endpoints.
 *
 * Mirrors `AttendanceController` (`@Controller('v1/attendance')`):
 *   - POST /v1/attendance/events        check in
 *   - POST /v1/attendance/check-out     check out
 *   - GET  /v1/attendance/records
 *   - GET  /v1/attendance/records/:id
 *   - GET  /v1/attendance/access-decisions
 */

import { api } from './api';
import type {
  AttendanceAccessDecision,
  AttendanceEventRequest,
  AttendanceEventResult,
  AttendanceRecord,
  Paginated,
  QueryAccessDecisionParams,
  QueryAttendanceRecordsParams,
} from './types';

export const attendanceApi = {
  listRecords: (params: QueryAttendanceRecordsParams = {}) =>
    api.get<Paginated<AttendanceRecord>>('/v1/attendance/records', {
      query: {
        page: params.page,
        limit: params.limit,
        member_id: params.member_id,
        branch_id: params.branch_id,
        from: params.from,
        to: params.to,
        check_in_method: params.check_in_method,
        open_only: params.open_only,
      },
    }),

  getRecord: (id: string) => api.get<AttendanceRecord>(`/v1/attendance/records/${id}`),

  listAccessDecisions: (params: QueryAccessDecisionParams = {}) =>
    api.get<Paginated<AttendanceAccessDecision>>('/v1/attendance/access-decisions', {
      query: {
        page: params.page,
        limit: params.limit,
        member_id: params.member_id,
        branch_id: params.branch_id,
        from: params.from,
        to: params.to,
        is_granted: params.is_granted,
      },
    }),

  /** Check a member in. A refusal throws `ApiError` (403) with a reason code. */
  checkIn: (payload: AttendanceEventRequest) =>
    api.post<AttendanceEventResult>('/v1/attendance/events', payload),

  /** Check a member out (closes their open session). */
  checkOut: (payload: AttendanceEventRequest) =>
    api.post<AttendanceEventResult>('/v1/attendance/check-out', payload),
};
