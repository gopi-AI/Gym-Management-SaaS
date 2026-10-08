import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { LoyaltyReadService } from '../services/loyalty-read.service';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';

/**
 * Loyalty points tab API (Phase 2, P2-08).
 *
 * Route layer wiring of the read-only `LoyaltyReadService`. The entities and
 * accrual/ledger logic were implemented in Phase 2; this controller adds no
 * writes.
 *
 * NOTE: `@RequirePermissions({ resource: 'loyalty', action: 'read' })` fails
 * closed (403) until the `loyalty:read` permission record is provisioned in the
 * RBAC store, mirroring the workout/diet `Provision*Permissions` migrations.
 * The wire is shipped without the permission record; provisioning it is a
 * separate, out-of-scope step for this PR.
 *
 * The `POST /points/adjust` write path is intentionally out of scope: there is
 * no atomic adjust service operation yet, and adding one would be design, not
 * wiring.
 */
@Controller('v1/members/:memberId/loyalty')
export class LoyaltyTabController {
  constructor(private readonly loyaltyReadService: LoyaltyReadService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'loyalty', action: 'read' })
  async getLoyalty(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ): Promise<{
    account: LoyaltyAccount;
    transactions: LoyaltyTransaction[];
  }> {
    const account = await this.loyaltyReadService.findAccountByMemberId(memberId);
    return {
      account,
      transactions: await this.loyaltyReadService.findAllTransactionsByMemberId(
        memberId,
      ),
    };
  }
}