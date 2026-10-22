import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsController } from './controllers/organizations.controller';
import { OrganizationsBranchController } from './controllers/organizations-branch.controller';
import { BranchesController } from './controllers/branches.controller';
import { BranchSettingsController } from './controllers/branch-settings.controller';
import { TenantSettingsController } from './controllers/tenant-settings.controller';
import { TenantSettingsService } from './services/tenant-settings.service';
import { BranchSettingsService } from './services/branch-settings.service';
import { OrganizationsService } from './services/organizations.service';
import { BranchesService } from './services/branches.service';
import { Organization } from './entities/organization.entity';
import { Branch } from './entities/branch.entity';
import { TenantSettings } from './entities/tenant-settings.entity';
import { BranchSettings } from './entities/branch-settings.entity';
import { BranchSettingsHistory } from './entities/branch-settings-history.entity';
import { TenantContextService } from '../shared/tenant/tenant-context.service';
import { TenantContextInterceptor } from '../shared/tenant/tenant-context.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, Branch, TenantSettings, BranchSettings, BranchSettingsHistory]), IdentityModule],
  controllers: [OrganizationsController, OrganizationsBranchController, BranchesController, TenantSettingsController, BranchSettingsController],
  providers: [
    OrganizationsService,
    BranchesService,
    TenantSettingsService,
    BranchSettingsService,
    TenantContextService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
  exports: [TenantContextService, OrganizationsService, BranchSettingsService],
})
export class TenancyModule {}
