import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { LoyaltyReadService } from '../services/loyalty-read.service';
import { LoyaltyDashboardResponse, QueryLoyaltyDashboardDto } from '../dto/loyalty-read.dto';

/**
 * Organization-level loyalty figures for P6-19's dashboard (P6-28).
 *
 * **Why `/v1/loyalty/dashboard` rather than `/v1/report/dashboards/loyalty`.**
 * §4.4 declares `GET /v1/report/dashboards/{domain}` as the dashboard-hub route,
 * and that is where this data will be reachable once the hub exists — but the hub
 * is P6-08, which has **no backlog ticket and no code**: `src/reports/` contains
 * only three entities and a `types/` module, there is no reports controller, and
 * `grep -rln 'dashboards' src/` returns nothing. Serving the dashboard from here
 * means P6-19 can be built now, and when P6-08 lands its route should *delegate* to
 * `LoyaltyReadService.getDashboard()` rather than re-implement the aggregates —
 * one implementation of §6.7's figures, in the module that owns the ledger.
 *
 * The response carries exactly §6.7's three Loyalty Reports rows, which is the
 * only description of what the dashboard renders (P6-19 is a plan §12 row with no
 * spec beyond its dependency on P6-08).
 *
 * Permission is `member:read` for the same reason the member-scoped routes use it
 * — no `loyalty` resource is seeded, and a dashboard over member loyalty data is
 * member data. Tenant scope comes from the request context, never a query
 * parameter; every aggregate query is filtered by the authorized organization.
 */
@Controller('v1/loyalty')
export class LoyaltyDashboardController {
  constructor(private readonly loyaltyReadService: LoyaltyReadService) {}

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'read' })
  async getDashboard(@Query() query: QueryLoyaltyDashboardDto): Promise<LoyaltyDashboardResponse> {
    return this.loyaltyReadService.getDashboard(query);
  }
}
