import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { LedgerService } from '../services/ledger.service';
import { QueryFinancialReportDto } from '../dto/query-financial-report.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Finance reports — `docs/phase3-scoping-plan.md` §1 (P3-01), served from the
 * plain views `V_FINANCE_REVENUE_BY_PERIOD` and
 * `V_FINANCE_OUTSTANDING_BY_STATUS`.
 *
 * Both routes reuse the existing `finance:read` permission (the approved P3-01
 * decision), so no new RBAC permission is provisioned and no migration is
 * needed for access control.
 *
 * These are read-only aggregations: they never write, and the organization is
 * taken from the authorized tenant context rather than from the query string.
 *
 * The generic `GET /v1/report/materialized-views*` endpoints in
 * `docs/api-plan.md` are NOT these: they belong to the Reports domain and are
 * out of scope for P3-01.
 */
@Controller('v1/financial-reports')
export class FinancialReportsController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get('revenue-summary')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async revenueSummary(@Query() query: QueryFinancialReportDto) {
    return this.ledgerService.getRevenueSummary(query);
  }

  @Get('outstanding-by-status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async outstandingByStatus() {
    return this.ledgerService.getOutstandingByStatus();
  }
}
