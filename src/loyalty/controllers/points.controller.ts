import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../shared/auth/current-user.decorator';
import { AdjustLoyaltyPointsDto } from '../dto/adjust-loyalty-points.dto';
import {
  AdjustLoyaltyPointsResult,
  LoyaltyAdjustService,
} from '../services/loyalty-adjust.service';

/**
 * Loyalty points write API (P2-08).
 *
 * `POST /v1/members/:memberId/points/adjust` is the internal/admin manual
 * adjustment path. It lives beside `LoyaltyTabController` rather than under the
 * tab's `v1/members/:memberId/loyalty` prefix because the backlog contract
 * names `.../points/adjust` explicitly.
 *
 * The route is a deliberate write, not tab wiring: all validation, locking,
 * idempotency and event emission live in `LoyaltyAdjustService`.
 */
@Controller('v1/members/:memberId/points')
export class PointsController {
  constructor(private readonly adjustService: LoyaltyAdjustService) {}

  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'loyalty', action: 'adjust' })
  async adjust(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: AdjustLoyaltyPointsDto,
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<AdjustLoyaltyPointsResult> {
    return this.adjustService.adjust(memberId, dto, user?.userId ?? null);
  }
}
