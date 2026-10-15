/**
 * Personal-training tab API endpoint (P2-04).
 *
 * Mirrors `PtTabController @Controller('v1/members/:memberId/pt')`.
 *
 * The aggregate carries bare `trainer_id` values only — the backend has no
 * hydrated trainer identity on enrollments or sessions (accepted gap, see the
 * P2-04 note in `docs/task-backlog.md`) — so the tab renders the id.
 */

import { api } from './api';
import type { PtTabResponse } from './types';

export const ptApi = {
  getTab: (memberId: string) =>
    api.get<PtTabResponse>(`/v1/members/${memberId}/pt`),
};
