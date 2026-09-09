import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { TenantContextService } from './tenant-context.service';

/**
 * Establishes the per-request tenant context from the VERIFIED JWT.
 *
 * - The authenticated user identity comes exclusively from the JWT `sub`
 *   claim. A client-supplied user ID is never used as proof of identity.
 * - The `X-Organization-Id` header (if present) is recorded as the *requested*
 *   organization context only. It is NOT treated as proof of authorization;
 *   every org-scoped operation must still pass validate/requireOrganizationAccess
 *   (which checks an ACTIVE IdentityUserOrganization membership).
 * - Context is stored via AsyncLocalStorage, so it is isolated per request and
 *   cannot leak between concurrent requests.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantContextService: TenantContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const headers = request.headers ?? {};

    const authHeader = headers['authorization'] ?? headers['Authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : null;

    const requestedOrg =
      headers['x-organization-id'] ?? headers['X-Organization-Id'];
    const requestedOrgId =
      typeof requestedOrg === 'string' && requestedOrg.length > 0
        ? requestedOrg
        : undefined;

    if (token) {
      try {
        const payload = this.jwtService.verify(token) as
          | { sub?: string }
          | string;
        const userId =
          typeof payload === 'object' && typeof payload.sub === 'string'
            ? payload.sub
            : undefined;
        if (userId) {
          return this.tenantContextService.runWithContext(
            {
              userId,
              requestedOrganizationId: requestedOrgId,
            },
            () => next.handle(),
          );
        }
      } catch (_err) {
        // Invalid/expired token → treat as unauthenticated. Guards/services
        // that require authentication will reject the request with 401/403.
      }
    }

    return next.handle();
  }
}