import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Member360Service } from '../services/member-360.service';
import { Member360HeaderResponse } from '../dto/member-360-header.dto';

/**
 * Member 360 Dashboard controller.
 *
 * Single aggregation endpoint that combines data from every Phase 2 module
 * into a read-side composition. Each tab section (memberships, PT, workouts,
 * diet, measurements, attendance, consents, documents) has its own dedicated
 * endpoint in its respective module — this controller only owns the header
 * aggregation.
 *
 * No P2-03 (Services tab) — deferred to Phase 3 per §12 Q28.
 */
@Controller('v1/members/:memberId/360')
export class Member360Controller {
  constructor(private readonly member360Service: Member360Service) {}

  /**
   * Aggregated header summary (P2-01).
   *
   * Combines: member profile, membership status, access/attendance status,
   * current measurement values, and computed quick actions — in a single
   * response.
   *
   * Returns 404 when the member does not belong to the caller's org (scoped
   * by `MembersService.findOne()`).
   */
  @Get('header')
  @HttpCode(HttpStatus.OK)
  async getHeader(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ): Promise<Member360HeaderResponse> {
    return this.member360Service.getHeader(memberId);
  }
}