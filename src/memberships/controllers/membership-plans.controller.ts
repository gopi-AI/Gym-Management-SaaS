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
import { MembershipPlansService } from '../services/membership-plans.service';
import { CreateMembershipPlanDto } from '../dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from '../dto/update-membership-plan.dto';
import { QueryMembershipPlanDto } from '../dto/query-membership-plan.dto';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

@Controller('v1/membership-plans')
export class MembershipPlansController {
  constructor(private readonly membershipPlansService: MembershipPlansService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership-plan', action: 'read' })
  async findAll(@Query() query: QueryMembershipPlanDto) {
    return this.membershipPlansService.findAll(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership-plan', action: 'read' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<MembershipPlan> {
    return this.membershipPlansService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'membership-plan', action: 'create' })
  async create(@Body() dto: CreateMembershipPlanDto): Promise<MembershipPlan> {
    return this.membershipPlansService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'membership-plan', action: 'update' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateMembershipPlanDto,
  ): Promise<MembershipPlan> {
    return this.membershipPlansService.update(id, dto);
  }
}