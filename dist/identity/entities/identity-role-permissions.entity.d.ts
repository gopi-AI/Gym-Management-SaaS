import { IdentityRole } from './identity-roles.entity';
import { IdentityPermission } from './identity-permissions.entity';
export declare class IdentityRolePermission {
    id: string;
    role_id: string;
    permission_id: string;
    role: IdentityRole;
    permission: IdentityPermission;
}
//# sourceMappingURL=identity-role-permissions.entity.d.ts.map