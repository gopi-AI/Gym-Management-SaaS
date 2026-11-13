import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityService } from '../../identity/services/identity.service';
import { ORGANIZATION_ACCESS_DENIED_MESSAGE } from '../tenant/tenant-context.service';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const SYSTEM_WIDE_KEY = 'systemWide';
export interface RequiredPermission {
  resource: string;
  action: string;
}
export const RequirePermissions = (...perms: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

/**
 * Marks a route as system-wide (not tenant-scoped). System-wide routes use the
 * approved global authorization path (`IdentityService.hasPermission()`) and do
 * NOT require an `X-Organization-Id` header or organization membership.
 *
 * Routes without this marker that carry `@RequirePermissions()` are treated as
 * tenant-scoped: they require valid organization context and use the
 * organization-scoped permission check (`hasOrganizationPermission()`).
 */
export const SystemWidePermissions = () => SetMetadata(SYSTEM_WIDE_KEY, true);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identityService: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const systemWide = this.reflector.getAllAndOverride<boolean>(
      SYSTEM_WIDE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId) throw new ForbiddenException('Not authenticated');

    if (systemWide) {
      // System-wide route: global authorization path, no organization context.
      for (const p of required) {
        const ok = await this.identityService.hasPermission(
          user.userId,
          p.resource,
          p.action,
        );
        if (!ok)
          throw new ForbiddenException(
            'Missing permission ' + p.resource + ':' + p.action,
          );
      }
      return true;
    }

    // Tenant-scoped route: organization context is mandatory.
    // Prefer the route parameter (:orgId) when present, since that is the
    // organization the controller will operate on. Fall back to the
    // X-Organization-Id header for routes without a route organization
    // segment (e.g. GET /v1/branches). Reject if both are present and
    // disagree — a request must not be authorized against one organization
    // while operating on another.
    const routeOrgId = req.params?.orgId;
    const headerOrgId = req.headers['x-organization-id'];

    let orgId: string;
    if (routeOrgId && typeof routeOrgId === 'string' && routeOrgId.trim() !== '') {
      orgId = routeOrgId.trim();
      if (
        headerOrgId &&
        typeof headerOrgId === 'string' &&
        headerOrgId.trim() !== '' &&
        headerOrgId.trim() !== orgId
      ) {
        throw new ForbiddenException(
          'Organization header does not match route organization',
        );
      }
    } else {
      orgId = headerOrgId;
      if (!orgId || typeof orgId !== 'string' || orgId.trim() === '') {
        throw new ForbiddenException('Organization context required');
      }
      orgId = orgId.trim();
    }

    // Tenant-context membership check runs BEFORE the RBAC evaluation.
    // `isUserInOrganization` is the authoritative predicate the tenant-context
    // layer itself uses (TenantContextService.requireOrganizationAccess), and it
    // must decide first so that a caller who is not a member of the requested
    // organization keeps the long-standing refusal
    // "Access to this organization is not allowed" instead of learning which
    // permission a role in an organization they never belonged to happens to
    // lack. Membership is not a substitute for the permission check below: a
    // member still has to hold the permission.
    const isMember = await this.identityService.isUserInOrganization(
      user.userId,
      orgId,
    );
    if (!isMember) {
      throw new ForbiddenException(ORGANIZATION_ACCESS_DENIED_MESSAGE);
    }

    for (const p of required) {
      const ok = await this.identityService.hasOrganizationPermission(
        user.userId,
        orgId,
        p.resource,
        p.action,
      );
      if (!ok)
        throw new ForbiddenException(
          'Missing permission ' + p.resource + ':' + p.action,
        );
    }
    return true;
  }
}