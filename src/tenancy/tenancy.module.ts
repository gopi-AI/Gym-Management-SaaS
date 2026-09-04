import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsService } from './services/organizations.service';
import { OrganizationsController } from './controllers/organizations.controller';
import { BranchesService } from './services/branches.service';
import { BranchesController } from './controllers/branches.controller';
import { Organization } from './entities/organization.entity';
import { Branch } from './entities/branch.entity';
import { TenantContextService } from '../shared/tenant/tenant-context.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, Branch])],
  controllers: [OrganizationsController, BranchesController],
  providers: [OrganizationsService, BranchesService, TenantContextService],
  exports: [TenantContextService],
})
export class TenancyModule {}