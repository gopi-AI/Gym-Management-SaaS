import { IdentityUserRole } from './identity-user-roles.entity';
import { IdentityRolePermission } from './identity-role-permissions.entity';
export declare class IdentityRole {
    id: string;
    name: string;
    description: string;
    created_at: Date;
    updated_at: Date;
    is_active: boolean;
    userRoles: IdentityUserRole[];
    rolePermissions: IdentityRolePermission[];
}
//# sourceMappingURL=identity-roles.entity.d.ts.map