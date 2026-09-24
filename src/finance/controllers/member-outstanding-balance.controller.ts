import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LedgerService } from '../services/ledger.service';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Member outstanding balance — `GET /v1/members/{id}/outstanding-balance`
 * (`docs/phase3-scoping-plan.md` §1, P3-01; `docs/api-plan.md` §Reports).
 *
 * The route is member-addressed because that is how the front desk asks the
 * question ("what does this member owe?"), but the resource is finance data, so
 * the controller lives in the finance module — §13 records the
 * `FinanceModule → MembersModule` import this requires (for member validation),
 * and it is guarded by `finance:read`, NOT by the members permission.
 *
 * The organization is never taken from the request: `LedgerService` derives it
 * from the authorized tenant context, and the member is validated through
 * `MembersService`, which is itself org-scoped. A member id belonging to another
 * organization is therefore indistinguishable from a missing one (404).
 */
@Controller('v1/members')
export class MemberOutstandingBalanceController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get(':id/outstanding-balance')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'finance', action: 'read' })
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.ledgerService.getMemberOutstandingBalance(id);
  }
}
