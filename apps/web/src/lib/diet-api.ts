/**
 * Diet tab API endpoint (P2-06).
 *
 * Mirrors `DietTabController @Controller('v1/members/:memberId/diet')`.
 * The backend defaults the daily-totals window to the last 30 days.
 */

import { api } from './api';
import type { DietTabResponse } from './types';

export const dietApi = {
  getTab: (memberId: string) =>
    api.get<DietTabResponse>(`/v1/members/${memberId}/diet`),
};
