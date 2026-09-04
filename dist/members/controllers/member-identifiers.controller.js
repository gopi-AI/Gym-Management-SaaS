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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemberIdentifiersController = void 0;
const common_1 = require("@nestjs/common");
const member_identifiers_service_1 = require("../services/member-identifiers.service");
const create_member_identifier_dto_1 = require("../dto/create-member-identifier.dto");
let MemberIdentifiersController = class MemberIdentifiersController {
    constructor(identifiersService) {
        this.identifiersService = identifiersService;
    }
    async findAll(memberId) {
        return this.identifiersService.findAllByMember(memberId);
    }
    async create(memberId, dto) {
        return this.identifiersService.create(memberId, dto);
    }
    async remove(memberId, identifierId) {
        await this.identifiersService.remove(memberId, identifierId);
    }
};
exports.MemberIdentifiersController = MemberIdentifiersController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('memberId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MemberIdentifiersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Param)('memberId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_member_identifier_dto_1.CreateMemberIdentifierDto]),
    __metadata("design:returntype", Promise)
], MemberIdentifiersController.prototype, "create", null);
__decorate([
    (0, common_1.Delete)(':identifierId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('memberId')),
    __param(1, (0, common_1.Param)('identifierId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], MemberIdentifiersController.prototype, "remove", null);
exports.MemberIdentifiersController = MemberIdentifiersController = __decorate([
    (0, common_1.Controller)('v1/members/:memberId/identifiers'),
    __metadata("design:paramtypes", [member_identifiers_service_1.MemberIdentifiersService])
], MemberIdentifiersController);
//# sourceMappingURL=member-identifiers.controller.js.map