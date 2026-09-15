import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsController } from './controllers/organizations.controller';
import { OrganizationsBranchController } from './controllers/organizations-branch.controller';
import { BranchesController } from './controllers/branches.controller';
import { TenantSettingsController } from './controllers/tenant-settings.controller';
import { OrganizationsService } from './services/organizations.service';
import { BranchesService } from './services/branches.service';
import { TenantSettingsService } from './services/tenant-settings.service';
import { Organization } from './entities/organization.entity';
import { Branch } from './entities/branch.entity';
import { TenantSettings } from './entities/tenant-settings.entity';
import { TenantContextService } from '../shared/tenant/tenant-context.service';
import { TenantContextInterceptor } from '../shared/tenant/tenant-context.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, Branch, TenantSettings]), IdentityModule],
  controllers: [OrganizationsController, OrganizationsBranchController, BranchesController, TenantSettingsController],
  providers: [
    OrganizationsService,
    BranchesService,
    TenantSettingsService,
    TenantContextService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
  // Only the SERVICES are exported — never the repositories. This enforces
  // the single-legal-write-path guarantee: no other module can bypass the
  // service-layer logic by injecting a repository directly.
  // `OrganizationsService` is exported because the PT module (Phase 2) needs the
  // organization's default currency as the creation-time default for
  // `PTPackage.currency` (§12 Q4) — read through the service, not a repository.
  exports: [TenantContextService, OrganizationsService],
})
export class TenancyModule {}
