/**
 * Workouts tab API endpoint (P2-05).
 *
 * Mirrors `WorkoutsTabController @Controller('v1/members/:memberId/workouts')`.
 */

import { api } from './api';
import type { WorkoutsTabResponse } from './types';

export const workoutsApi = {
  getTab: (memberId: string) =>
    api.get<WorkoutsTabResponse>(`/v1/members/${memberId}/workouts`),
};
