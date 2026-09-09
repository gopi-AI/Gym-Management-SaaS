import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../../tenancy/entities/branch.entity';
import { IdentityService } from '../../identity/services/identity.service';
import { RequestTenantContext, tenantAsyncLocal } from './tenant-context.store';

const EMPTY_CONTEXT: RequestTenantContext = Object.freeze({});

@Injectable()
export class TenantContextService {
  constructor(
    private readonly identityService: IdentityService,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
  ) {}

  // ---------------------------------------------------------------------------
  // Request-scoped store access
  // ---------------------------------------------------------------------------

  private getStore(): RequestTenantContext {
    const store = tenantAsyncLocal.getStore();
    return store ?? EMPTY_CONTEXT;
  }

  /**
   * Run a callback (typically the remainder of the request pipeline) inside a
   * request-scoped tenant context. Every asynchronous continuation of the
   * callback will observe the same isolated context.
   */
  runWithContext<T>(context: RequestTenantContext, callback: () => T): T {
    return tenantAsyncLocal.run(context, callback);
  }

  getContext(): RequestTenantContext {
    return this.getStore();
  }

  async getCurrentUserId(): Promise<string | null> {
    return this.getStore().userId ?? null;
  }

  async getCurrentOrganizationId(): Promise<string | null> {
    return this.getStore().organizationId ?? null;
  }

  async getCurrentBranchId(): Promise<string | null> {
    return this.getStore().branchId ?? null;
  }

  async getRequestedOrganizationId(): Promise<string | null> {
    return this.getStore().requestedOrganizationId ?? null;
  }

  /**
   * Set the authenticated user for the current request context.
   * Only ever called with the `sub` from a verified JWT.
   */
  async setAuthenticatedUser(userId: string): Promise<void> {
    this.requireMutableStore().userId = userId;
  }

  /**
   * Record the organization requested by the client (route/header/query/body).
   * This is NOT authorization; it is merely the requested context that must
   * still be validated against active membership.
   */
  async setRequestedOrganizationId(orgId: string): Promise<void> {
    this.requireMutableStore().requestedOrganizationId = orgId;
  }

  async setCurrentOrganizationId(orgId: string): Promise<void> {
    this.requireMutableStore().organizationId = orgId;
  }

  async setCurrentBranchId(branchId: string): Promise<void> {
    this.requireMutableStore().branchId = branchId;
  }

  // ---------------------------------------------------------------------------
  // Authorization checks
  // ---------------------------------------------------------------------------

  private requireMutableStore(): RequestTenantContext {
    const store = tenantAsyncLocal.getStore();
    if (!store) {
      // No request context established (e.g. called outside the interceptor).
      // Throw rather than silently leaking into a shared/global object.
      throw new UnauthorizedException('No authenticated request context');
    }
    return store;
  }

  /**
   * Require an authenticated user (identity from the verified JWT only).
   * Throws UnauthorizedException if the request is not authenticated.
   */
  async assertAuthenticated(): Promise<string> {
    const userId = await this.getCurrentUserId();
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    return userId;
  }

  /**
   * Authoritative tenant check:
   *   authenticatedUserId -> ACTIVE IdentityUserOrganization membership ->
   *   requested organizationId
   *
   * Returns the authorized orgId on success; throws 401/403 otherwise.
   */
  async requireOrganizationAccess(orgId: string): Promise<string> {
    const userId = await this.assertAuthenticated();

    const isMember = await this.identityService.isUserInOrganization(userId, orgId);
    if (!isMember) {
      throw new ForbiddenException('Access to this organization is not allowed');
    }

    await this.setCurrentOrganizationId(orgId);
    return orgId;
  }

  /**
   * Boolean form of requireOrganizationAccess. Also establishes the org
   * context on success.
   */
  async validateOrganizationAccess(orgId: string): Promise<boolean> {
    const userId = await this.getCurrentUserId();
    if (!userId) {
      return false;
    }
    const isMember = await this.identityService.isUserInOrganization(userId, orgId);
    if (!isMember) {
      return false;
    }
    await this.setCurrentOrganizationId(orgId);
    return true;
  }

  /**
   * Branch ownership check: the branch must exist, be active, and belong to
   * the authorized organization. Throws 401/403 otherwise.
   */
  async requireBranchAccess(orgId: string, branchId: string): Promise<Branch> {
    await this.requireOrganizationAccess(orgId);

    const branch = await this.branchRepository.findOne({
      where: { id: branchId, organization_id: orgId, is_active: true },
    });
    if (!branch) {
      throw new ForbiddenException('Access to this branch is not allowed');
    }

    await this.setCurrentBranchId(branchId);
    return branch;
  }

  /**
   * Boolean form of requireBranchAccess.
   */
  async validateBranchAccess(orgId: string, branchId: string): Promise<boolean> {
    const orgOk = await this.validateOrganizationAccess(orgId);
    if (!orgOk) {
      return false;
    }

    const branch = await this.branchRepository.findOne({
      where: { id: branchId, organization_id: orgId, is_active: true },
    });
    if (!branch) {
      return false;
    }

    await this.setCurrentBranchId(branchId);
    return true;
  }
}