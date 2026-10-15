/**
 * Loyalty points tab API endpoint (P2-08).
 *
 * Mirrors `LoyaltyTabController @Controller('v1/members/:memberId/loyalty')`.
 *
 * A 404 here is a normal answer, not a failure: the backend has no loyalty
 * account row until the member's first point-earning event, and both read
 * methods throw `NotFoundException` in that case. The tab renders it as an
 * empty state rather than an error.
 */

import { api } from './api';
import type { LoyaltyTabResponse } from './types';

export const loyaltyApi = {
  getTab: (memberId: string) =>
    api.get<LoyaltyTabResponse>(`/v1/members/${memberId}/loyalty`),
};
