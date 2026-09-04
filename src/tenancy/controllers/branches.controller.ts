import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { BranchesService } from '../services/branches.service';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { Branch } from '../entities/branch.entity';

@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(): Promise<Branch[]> {
    return this.branchesService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string): Promise<Branch | null> {
    return this.branchesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateBranchDto): Promise<Branch> {
    return this.branchesService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() dto: UpdateBranchDto): Promise<Branch | null> {
    return this.branchesService.update(id, dto);
  }
}

@Controller('v1/organizations')
export class OrganizationsBranchController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post(':orgId/branches')
  @HttpCode(HttpStatus.CREATED)
  async createBranchForOrganization(@Param('orgId') orgId: string, @Body() dto: CreateBranchDto): Promise<Branch> {
    return this.branchesService.create({ ...dto, organization_id: orgId });
  }

  @Get(':orgId/branches')
  @HttpCode(HttpStatus.OK)
  async findBranchesByOrganization(@Param('orgId') orgId: string): Promise<Branch[]> {
    return this.branchesService.findAll().then(branches => branches.filter(b => b.organization_id === orgId));
  }
}