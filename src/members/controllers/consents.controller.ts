import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConsentsService } from '../services/consents.service';
import { GrantConsentDto } from '../dto/grant-consent.dto';
import { RevokeConsentDto } from '../dto/revoke-consent.dto';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { ConsentType } from '../entities/consent-type.enum';

@Controller('v1/members')
export class ConsentsController {
  constructor(
    private readonly consentsService: ConsentsService,
  ) {}

  @Post(':memberId/consents')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'member', action: 'consent-manage' })
  async grant(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: GrantConsentDto,
  ) {
    return this.consentsService.grant(memberId, dto);
  }

  @Post(':memberId/consents/revoke')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'member', action: 'consent-manage' })
  async revoke(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: RevokeConsentDto,
  ) {
    return this.consentsService.revoke(memberId, dto);
  }

  @Get(':memberId/consents')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'consent-read' })
  async findAll(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) {
    return this.consentsService.findAll(memberId);
  }

  @Get(':memberId/consents/current')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'member', action: 'consent-read' })
  async getCurrentStatus(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Query('consent_type') consentType?: ConsentType,
  ) {
    if (consentType) {
      return this.consentsService.getCurrentStatus(memberId, consentType);
    }
    return this.consentsService.getAllCurrentStatuses(memberId);
  }
}