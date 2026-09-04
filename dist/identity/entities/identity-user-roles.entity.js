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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityUserRole = void 0;
const typeorm_1 = require("typeorm");
const identity_roles_entity_1 = require("./identity-roles.entity");
let IdentityUserRole = class IdentityUserRole {
};
exports.IdentityUserRole = IdentityUserRole;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], IdentityUserRole.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], IdentityUserRole.prototype, "user_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], IdentityUserRole.prototype, "role_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => identity_roles_entity_1.IdentityRole, (role) => role.userRoles),
    (0, typeorm_1.JoinColumn)({ name: 'role_id' }),
    __metadata("design:type", identity_roles_entity_1.IdentityRole)
], IdentityUserRole.prototype, "role", void 0);
exports.IdentityUserRole = IdentityUserRole = __decorate([
    (0, typeorm_1.Entity)('IDENTITY_USER_ROLES')
], IdentityUserRole);
//# sourceMappingURL=identity-user-roles.entity.js.map