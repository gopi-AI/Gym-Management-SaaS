"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenancyModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const organizations_service_1 = require("./services/organizations.service");
const organizations_controller_1 = require("./controllers/organizations.controller");
const branches_service_1 = require("./services/branches.service");
const branches_controller_1 = require("./controllers/branches.controller");
const organization_entity_1 = require("./entities/organization.entity");
const branch_entity_1 = require("./entities/branch.entity");
const tenant_context_service_1 = require("../shared/tenant/tenant-context.service");
let TenancyModule = class TenancyModule {
};
exports.TenancyModule = TenancyModule;
exports.TenancyModule = TenancyModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([organization_entity_1.Organization, branch_entity_1.Branch])],
        controllers: [organizations_controller_1.OrganizationsController, branches_controller_1.BranchesController],
        providers: [organizations_service_1.OrganizationsService, branches_service_1.BranchesService, tenant_context_service_1.TenantContextService],
        exports: [tenant_context_service_1.TenantContextService],
    })
], TenancyModule);
//# sourceMappingURL=tenancy.module.js.map