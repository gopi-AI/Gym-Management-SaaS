"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantContextService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let TenantContextService = class TenantContextService {
    constructor(configService, cacheManager) {
        this.configService = configService;
        this.cacheManager = cacheManager;
        this.tenantCacheTTL = 300; // 5 minutes
    }
    /**
     * Get the current organization ID from the request context
     */
    async getCurrentOrganizationId() {
        const cached = await this.cacheManager.get('current_organization_id');
        if (cached) {
            return cached;
        }
        // In a real implementation, this would come from the request headers/middleware
        // For now, return null - the middleware will set this
        return null;
    }
    /**
     * Get the current branch ID from the request context
     */
    async getCurrentBranchId() {
        const cached = await this.cacheManager.get('current_branch_id');
        if (cached) {
            return cached;
        }
        return null;
    }
    /**
     * Set the current organization ID in the context
     */
    async setCurrentOrganizationId(orgId) {
        await this.cacheManager.set('current_organization_id', orgId, this.tenantCacheTTL);
    }
    /**
     * Set the current branch ID in the context
     */
    async setCurrentBranchId(branchId) {
        await this.cacheManager.set('current_branch_id', branchId, this.tenantCacheTTL);
    }
    /**
     * Validate that the current user has access to the organization
     */
    async validateOrganizationAccess(orgId) {
        // TODO: Implement proper organization access validation
        // This would check RBAC, user roles, etc.
        return true;
    }
    /**
     * Validate that the current user has access to the branch
     */
    async validateBranchAccess(orgId, branchId) {
        // TODO: Implement proper branch access validation
        return true;
    }
};
exports.TenantContextService = TenantContextService;
exports.TenantContextService = TenantContextService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)('CACHE_MANAGER')),
    __metadata("design:paramtypes", [config_1.ConfigService, Object])
], TenantContextService);
//# sourceMappingURL=tenant-context.service.js.map