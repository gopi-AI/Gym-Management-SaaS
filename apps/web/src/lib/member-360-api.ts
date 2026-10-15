/**
 * Member 360 header API endpoint (P2-01).
 *
 * Mirrors `Member360Controller @Controller('v1/members/:memberId/360')`.
 * The per-tab data lives in each domain's own module: memberships in
 * `memberships-api.ts`, and the rest in `pt-api.ts`, `workouts-api.ts`,
 * `diet-api.ts` and `loyalty-api.ts`.
 */

import { api } from './api';
import type { Member360HeaderResponse } from './types';

export const member360Api = {
  getHeader: (memberId: string) =>
    api.get<Member360HeaderResponse>(`/v1/members/${memberId}/360/header`),
};
