import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MembershipsService } from '../services/memberships.service';
import { CreateMembershipDto } from '../dto/create-membership.dto';
import { UpdateMembershipDto } from '../dto/update-membership.dto';
import { QueryMembershipDto } from '../dto/query-membership.dto';
import { MembershipLifecycleDto } from '../dto/membership-lifecycle.dto';
import { Membership } from '../entities/membership.entity';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

@Controller('v1/memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'read' })
  async findAll(@Query() query: QueryMembershipDto) {
    return this.membershipsService.findAll(query);
  }

@Get('/member/:memberId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'read' })
  async findByMember(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Query() query: QueryMembershipDto,
  ) {
    return this.membershipsService.findByMember(memberId, query);
  }
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'read' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Membership> {
    return this.membershipsService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'membership', action: 'create' })
  async create(@Body() dto: CreateMembershipDto): Promise<Membership> {
    return this.membershipsService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'update' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateMembershipDto,
  ): Promise<Membership> {
    return this.membershipsService.update(id, dto);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'pause' })
  async pause(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MembershipLifecycleDto,
  ): Promise<Membership> {
    return this.membershipsService.pause(id, dto);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'resume' })
  async resume(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MembershipLifecycleDto,
  ): Promise<Membership> {
    return this.membershipsService.resume(id, dto);
  }

  @Post(':id/freeze')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'freeze' })
  async freeze(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MembershipLifecycleDto,
  ): Promise<Membership> {
    return this.membershipsService.freeze(id, dto);
  }

  @Post(':id/unfreeze')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'unfreeze' })
  async unfreeze(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MembershipLifecycleDto,
  ): Promise<Membership> {
    return this.membershipsService.unfreeze(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership', action: 'cancel' })
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MembershipLifecycleDto,
  ): Promise<Membership> {
    return this.membershipsService.cancel(id, dto);
  }
}