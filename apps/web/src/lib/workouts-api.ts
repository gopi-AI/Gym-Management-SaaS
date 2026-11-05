/**
 * Workouts API (P2-05).
 *
 * Mirrors the backend controllers under `v1/workouts` plus the combined Member
 * 360 tab read at `GET /v1/members/:memberId/workouts`. Every call goes through
 * `lib/api.ts`, which attaches the bearer token and `X-Organization-Id`.
 */

import { api } from './api';
import type {
  CreateAssignmentRequest,
  CreateExerciseRequest,
  CreateProgressReviewRequest,
  DayTemplateExerciseInput,
  Exercise,
  PlanDayReview,
  PlanDaySubmission,
  PlanTemplateDayInput,
  PrescribedDayDetail,
  PrescribedWorkoutDay,
  ProgressReviewComparison,
  WorkoutDayTemplate,
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
  WorkoutProgressReview,
  WorkoutSequenceEntry,
  WorkoutSession,
  WorkoutsTabResponse,
} from './types';

export interface ListExercisesParams {
  search?: string;
  category?: string;
  is_active?: boolean;
}

export interface ListWorkoutSessionsParams {
  include_deleted?: boolean;
  prescribed_day_id?: string;
  assignment_id?: string;
}

export interface WorkoutSessionExerciseRequest {
  exercise_id: string;
  prescribed_day_exercise_id?: string;
  completed?: boolean;
  sets_completed?: number;
  reps_completed?: number;
  weight_used?: number;
  rpe?: number;
  notes?: string;
}

export interface CreateWorkoutSessionRequest {
  session_date?: string;
  assignment_id?: string;
  prescribed_day_id?: string;
  template_id?: string;
  notes?: string;
  mood?: number;
  duration_minutes?: number;
  exercises?: WorkoutSessionExerciseRequest[];
}

export interface UpdateWorkoutSessionRequest {
  notes?: string;
  mood?: number;
  duration_minutes?: number;
  exercises?: WorkoutSessionExerciseRequest[];
}

export const workoutsApi = {
  // Member 360 tab -----------------------------------------------------------
  getTab: (memberId: string) =>
    api.get<WorkoutsTabResponse>(`/v1/members/${memberId}/workouts`),

  // Exercise library ---------------------------------------------------------
  listExercises: (params: ListExercisesParams = {}) =>
    api.get<Exercise[]>('/v1/workouts/exercises', {
      query: {
        search: params.search,
        category: params.category,
        is_active: params.is_active,
      },
    }),
  getExercise: (id: string) =>
    api.get<Exercise>(`/v1/workouts/exercises/${id}`),
  createExercise: (payload: CreateExerciseRequest) =>
    api.post<Exercise>('/v1/workouts/exercises', payload),
  updateExercise: (id: string, payload: Partial<CreateExerciseRequest>) =>
    api.patch<Exercise>(`/v1/workouts/exercises/${id}`, payload),
  uploadExerciseMedia: (id: string, mediaType: 'image' | 'gif', file: File) => {
    const form = new FormData();
    form.append('media_type', mediaType);
    form.append('file', file);
    return api.postForm<Exercise>(`/v1/workouts/exercises/${id}/media`, form);
  },
  setExerciseVideo: (id: string, videoUrl: string) =>
    api.put<Exercise>(`/v1/workouts/exercises/${id}/video`, {
      video_url: videoUrl,
    }),
  clearExerciseVideo: (id: string) =>
    api.delete<Exercise>(`/v1/workouts/exercises/${id}/video`),

  // Reusable day templates ---------------------------------------------------
  listDayTemplates: () =>
    api.get<WorkoutDayTemplate[]>('/v1/workouts/day-templates'),
  createDayTemplate: (payload: {
    name: string;
    description?: string;
    estimated_duration_minutes?: number;
  }) => api.post<WorkoutDayTemplate>('/v1/workouts/day-templates', payload),
  getDayTemplate: (id: string) =>
    api.get<WorkoutDayTemplate>(`/v1/workouts/day-templates/${id}`),
  updateDayTemplate: (
    id: string,
    payload: {
      name?: string;
      description?: string;
      estimated_duration_minutes?: number;
      is_active?: boolean;
    },
  ) => api.patch<WorkoutDayTemplate>(`/v1/workouts/day-templates/${id}`, payload),
  setDayTemplateExercises: (
    id: string,
    exercises: DayTemplateExerciseInput[],
  ) =>
    api.put<WorkoutDayTemplate>(`/v1/workouts/day-templates/${id}/exercises`, {
      exercises,
    }),
  copyDayTemplate: (id: string, name?: string) =>
    api.post<WorkoutDayTemplate>(`/v1/workouts/day-templates/${id}/copy`, {
      name,
    }),

  // Reusable weekly plan templates ------------------------------------------
  listPlanTemplates: () =>
    api.get<WorkoutPlanTemplate[]>('/v1/workouts/plan-templates'),
  createPlanTemplate: (payload: { name: string; description?: string }) =>
    api.post<WorkoutPlanTemplate>('/v1/workouts/plan-templates', payload),
  getPlanTemplate: (id: string) =>
    api.get<WorkoutPlanTemplate>(`/v1/workouts/plan-templates/${id}`),
  updatePlanTemplate: (
    id: string,
    payload: { name?: string; description?: string; is_active?: boolean },
  ) =>
    api.patch<WorkoutPlanTemplate>(
      `/v1/workouts/plan-templates/${id}`,
      payload,
    ),
  setPlanTemplateDays: (id: string, days: PlanTemplateDayInput[]) =>
    api.put<WorkoutPlanTemplate>(`/v1/workouts/plan-templates/${id}/days`, {
      days,
    }),

  // Assignments and rolling sequence ---------------------------------------
  listAssignments: (memberId: string) =>
    api.get<WorkoutPlanAssignment[]>(
      `/v1/workouts/members/${memberId}/assignments`,
    ),
  createAssignment: (memberId: string, payload: CreateAssignmentRequest) =>
    api.post<WorkoutPlanAssignment>(
      `/v1/workouts/members/${memberId}/assignments`,
      payload,
    ),
  getAssignment: (id: string) =>
    api.get<{
      assignment: WorkoutPlanAssignment;
      days: PrescribedWorkoutDay[];
      progress: {
        completed: number;
        prescribed: number;
        percentage: number;
      };
    }>(`/v1/workouts/assignments/${id}`),
  getSequence: (memberId: string) =>
    api.get<WorkoutSequenceEntry[]>(
      `/v1/workouts/members/${memberId}/sequence`,
    ),

  // Prescribed days ---------------------------------------------------------
  getPrescribedDay: (id: string) =>
    api.get<PrescribedDayDetail>(`/v1/workouts/prescribed-days/${id}`),
  submitPrescribedDay: (id: string, notes?: string) =>
    api.post<PlanDaySubmission>(`/v1/workouts/prescribed-days/${id}/submit`, {
      notes,
    }),
  reviewPrescribedDay: (
    id: string,
    decision: 'approve' | 'request_remaining',
    notes?: string,
  ) =>
    api.post<{ review: PlanDayReview; day: PrescribedWorkoutDay }>(
      `/v1/workouts/prescribed-days/${id}/review`,
      { decision, notes },
    ),
  listDaySubmissions: (id: string) =>
    api.get<PlanDaySubmission[]>(
      `/v1/workouts/prescribed-days/${id}/submissions`,
    ),
  listDayReviews: (id: string) =>
    api.get<PlanDayReview[]>(`/v1/workouts/prescribed-days/${id}/reviews`),

  // Sessions ----------------------------------------------------------------
  listMemberSessions: (
    memberId: string,
    params: ListWorkoutSessionsParams = {},
  ) =>
    api.get<WorkoutSession[]>(`/v1/workouts/members/${memberId}/sessions`, {
      query: {
        include_deleted: params.include_deleted,
        prescribed_day_id: params.prescribed_day_id,
        assignment_id: params.assignment_id,
      },
    }),
  getSession: (id: string) =>
    api.get<WorkoutSession>(`/v1/workouts/sessions/${id}`),
  createSession: (
    memberId: string,
    payload: CreateWorkoutSessionRequest,
  ) =>
    api.post<WorkoutSession>(
      `/v1/workouts/members/${memberId}/sessions`,
      payload,
    ),
  updateSession: (id: string, payload: UpdateWorkoutSessionRequest) =>
    api.patch<WorkoutSession>(`/v1/workouts/sessions/${id}`, payload),
  finishSession: (id: string) =>
    api.post<WorkoutSession>(`/v1/workouts/sessions/${id}/finish`),
  cancelSession: (id: string) =>
    api.post<WorkoutSession>(`/v1/workouts/sessions/${id}/cancel`),
  deleteSession: (id: string) =>
    api.delete<{ success: true; id: string; deleted_at: string | null }>(
      `/v1/workouts/sessions/${id}`,
    ),

  // Progress reviews --------------------------------------------------------
  listProgressReviews: (memberId: string, assignmentId?: string) =>
    api.get<WorkoutProgressReview[]>(
      `/v1/workouts/members/${memberId}/progress-reviews`,
      { query: { assignment_id: assignmentId } },
    ),
  createProgressReview: (
    memberId: string,
    payload: CreateProgressReviewRequest,
  ) =>
    api.post<{
      review: WorkoutProgressReview;
      resulting_assignment: WorkoutPlanAssignment | null;
    }>(`/v1/workouts/members/${memberId}/progress-reviews`, payload),
  getProgressReview: (id: string) =>
    api.get<WorkoutProgressReview>(`/v1/workouts/progress-reviews/${id}`),
  getProgressComparison: (memberId: string) =>
    api.get<ProgressReviewComparison>(
      `/v1/workouts/members/${memberId}/progress-reviews/comparison`,
    ),
};
