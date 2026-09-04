"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const identity_users_entity_1 = require("./entities/identity-users.entity");
const identity_roles_entity_1 = require("./entities/identity-roles.entity");
const identity_permissions_entity_1 = require("./entities/identity-permissions.entity");
const identity_user_roles_entity_1 = require("./entities/identity-user-roles.entity");
const identity_role_permissions_entity_1 = require("./entities/identity-role-permissions.entity");
const identity_auth_tokens_entity_1 = require("./entities/identity-auth-tokens.entity");
const identity_mfa_secrets_entity_1 = require("./entities/identity-mfa-secrets.entity");
const identity_service_1 = require("./services/identity.service");
const auth_service_1 = require("./services/auth.service");
let IdentityModule = class IdentityModule {
};
exports.IdentityModule = IdentityModule;
exports.IdentityModule = IdentityModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([
                identity_users_entity_1.IdentityUser,
                identity_roles_entity_1.IdentityRole,
                identity_permissions_entity_1.IdentityPermission,
                identity_user_roles_entity_1.IdentityUserRole,
                identity_role_permissions_entity_1.IdentityRolePermission,
                identity_auth_tokens_entity_1.IdentityAuthToken,
                identity_mfa_secrets_entity_1.IdentityMfaSecret,
            ])],
        providers: [identity_service_1.IdentityService, auth_service_1.AuthService],
        controllers: [],
        exports: [typeorm_1.TypeOrmModule, identity_service_1.IdentityService, auth_service_1.AuthService],
    })
], IdentityModule);
//# sourceMappingURL=identity.module.js.map