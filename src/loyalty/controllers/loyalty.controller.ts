import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { LoyaltyReadService } from '../services/loyalty-read.service';
import {
  LoyaltyBalanceResponse,
  LoyaltyTransactionsResponse,
  QueryLoyaltyTransactionsDto,
} from '../dto/loyalty-read.dto';

/**
 * Member-scoped loyalty reads (P6-28).
 *
 * The paths are P2-08's own — `GET /v1/members/{memberId}/points/balance` and
 * `.../points/transactions` — rather than newly invented ones. P2-08 is still
 * open and declares exactly these two reads; what it also declares is
 * `POST .../points/adjust`, a mutation that is NOT here, because P6-28 is a read
 * path and an admin adjustment is a different operation with different
 * authorization. P2-08's "Files/modules affected" line suggests
 * `src/notifications/ or src/members/` for the points service, but the data belongs
 * to the loyalty module, which now owns and reads it.
 *
 * **Permission**: `member:read`. There is no `loyalty` permission resource —
 * verified against the seeded set (`ai`, `attendance`, `branch`, `finance`,
 * `measurement`, `member`, `membership`, `membership-plan`, `organization`,
 * `tenant-settings`) — and `PermissionsGuard` denies everything for a resource
 * with no rows, so using `loyalty:read` would 403 every caller until a permission
 * seed existed. Seeding one is a database change, which P6-28 explicitly excludes
 * ("Database changes: None"). These routes read one member's data, so the seeded
 * `member:read` is the permission that matches; `loyalty:read` would be the better
 * long-term resource and belongs with whoever owns the loyalty permission seeds.
 *
 * Tenant scope is not a route parameter: `LoyaltyReadService` reads the authorized
 * organization from the request context, and a `memberId` outside it is rejected
 * with 404.
 */
@Controller('v1/members/:memberId/points')
export class LoyaltyController {
  constructor(private readonly loyaltyReadService: LoyaltyReadService) {}

  @Get('balance')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'read' })
  async getBalance(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ): Promise<LoyaltyBalanceResponse> {
    return this.loyaltyReadService.getBalance(memberId);
  }

  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'read' })
  async getTransactions(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Query() query: QueryLoyaltyTransactionsDto,
  ): Promise<LoyaltyTransactionsResponse> {
    return this.loyaltyReadService.getTransactions(memberId, query);
  }
}
