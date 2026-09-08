import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityService } from '../../identity/services/identity.service';

export const PERMISSIONS_KEY = 'requiredPermissions';
export interface RequiredPermission {
  resource: string;
  action: string;
}
export const RequirePermissions = (...perms: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

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

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId) throw new ForbiddenException('Not authenticated');

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
}