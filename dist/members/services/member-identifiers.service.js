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
exports.MemberIdentifiersService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const member_identifier_entity_1 = require("../entities/member-identifier.entity");
const members_service_1 = require("./members.service");
let MemberIdentifiersService = class MemberIdentifiersService {
    constructor(identifierRepository, membersService) {
        this.identifierRepository = identifierRepository;
        this.membersService = membersService;
    }
    async findAllByMember(memberId) {
        await this.membersService.findOne(memberId);
        return this.identifierRepository.find({
            where: { member_id: memberId },
            order: { identifier_type: 'ASC' },
        });
    }
    async create(memberId, dto) {
        await this.membersService.findOne(memberId);
        const identifier = this.identifierRepository.create({
            member_id: memberId,
            identifier_type: dto.identifier_type,
            identifier_value: dto.identifier_value,
            is_primary: dto.is_primary ?? false,
        });
        return this.identifierRepository.save(identifier);
    }
    async remove(memberId, identifierId) {
        await this.membersService.findOne(memberId);
        const result = await this.identifierRepository.delete({ id: identifierId, member_id: memberId });
        if (result.affected === 0) {
            throw new common_1.NotFoundException('Identifier not found');
        }
    }
};
exports.MemberIdentifiersService = MemberIdentifiersService;
exports.MemberIdentifiersService = MemberIdentifiersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(member_identifier_entity_1.MemberIdentifier)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        members_service_1.MembersService])
], MemberIdentifiersService);
//# sourceMappingURL=member-identifiers.service.js.map