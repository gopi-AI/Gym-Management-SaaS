import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
export declare class TenantContextService {
    private readonly configService;
    private readonly cacheManager;
    private readonly tenantCacheTTL;
    constructor(configService: ConfigService, cacheManager: Cache);
    /**
     * Get the current organization ID from the request context
     */
    getCurrentOrganizationId(): Promise<string | null>;
    /**
     * Get the current branch ID from the request context
     */
    getCurrentBranchId(): Promise<string | null>;
    /**
     * Set the current organization ID in the context
     */
    setCurrentOrganizationId(orgId: string): Promise<void>;
    /**
     * Set the current branch ID in the context
     */
    setCurrentBranchId(branchId: string): Promise<void>;
    /**
     * Validate that the current user has access to the organization
     */
    validateOrganizationAccess(orgId: string): Promise<boolean>;
    /**
     * Validate that the current user has access to the branch
     */
    validateBranchAccess(orgId: string, branchId: string): Promise<boolean>;
}
//# sourceMappingURL=tenant-context.service.d.ts.map