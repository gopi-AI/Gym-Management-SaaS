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
exports.MemberIdentifier = void 0;
const typeorm_1 = require("typeorm");
const member_entity_1 = require("./member.entity");
let MemberIdentifier = class MemberIdentifier {
};
exports.MemberIdentifier = MemberIdentifier;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], MemberIdentifier.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], MemberIdentifier.prototype, "member_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 50 }),
    __metadata("design:type", String)
], MemberIdentifier.prototype, "identifier_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], MemberIdentifier.prototype, "identifier_value", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], MemberIdentifier.prototype, "is_primary", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => member_entity_1.Member, (member) => member.identifiers),
    __metadata("design:type", member_entity_1.Member)
], MemberIdentifier.prototype, "member", void 0);
exports.MemberIdentifier = MemberIdentifier = __decorate([
    (0, typeorm_1.Entity)('MEMBERS_MEMBER_IDENTIFIERS')
], MemberIdentifier);
//# sourceMappingURL=member-identifier.entity.js.map