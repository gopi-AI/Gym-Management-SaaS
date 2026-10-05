import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { LoyaltyReadService } from '../services/loyalty-read.service';
import { LoyaltyDashboardResponse, QueryLoyaltyDashboardDto } from '../dto/loyalty-read.dto';

/**
 * Organization-level loyalty figures for P6-19's dashboard (P6-28).
 *
 * **Why `/v1/loyalty/dashboard` rather than `/v1/report/dashboards/loyalty`.**
 * §4.4 declares `GET /v1/report/dashboards/{domain}` as the dashboard-hub route,
 * and that is where this data will be reachable once the hub is built. The hub is
 * P6-08, now filed as a ticket (`docs/task-backlog.md:877`) though its routes are
 * not yet built, and its `loyalty` domain is served by P6-08's own
 * `DashboardsService`, which is **repository-only**: it re-queries these figures
 * from `LoyaltyTransaction` entity metadata directly, the same ledger this module
 * reads, rather than importing or delegating to `LoyaltyReadService`. That follows
 * §2.2 (`docs/phase6-scoping-plan.md:96`; rationale at `:114`), under which
 * `ReportsModule` reads domain *entities* and does **not** import domain *services*.
 * Serving the dashboard from here means P6-19 can be built now, and this route
 * stays in place when the hub lands — two reads of the same organization-scoped
 * ledger, not one implementation delegating to the other.
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
