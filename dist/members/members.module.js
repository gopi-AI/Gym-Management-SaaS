"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembersModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const tenancy_module_1 = require("../tenancy/tenancy.module");
const member_entity_1 = require("./entities/member.entity");
const member_identifier_entity_1 = require("./entities/member-identifier.entity");
const member_profile_entity_1 = require("./entities/member-profile.entity");
const local_id_counter_entity_1 = require("./entities/local-id-counter.entity");
const outbox_entity_1 = require("../shared/outbox/outbox.entity");
const outbox_service_1 = require("../shared/outbox/outbox.service");
const members_service_1 = require("./services/members.service");
const member_identifiers_service_1 = require("./services/member-identifiers.service");
const local_id_service_1 = require("./services/local-id.service");
const members_controller_1 = require("./controllers/members.controller");
const member_identifiers_controller_1 = require("./controllers/member-identifiers.controller");
let MembersModule = class MembersModule {
};
exports.MembersModule = MembersModule;
exports.MembersModule = MembersModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([member_entity_1.Member, member_identifier_entity_1.MemberIdentifier, member_profile_entity_1.MemberProfile, local_id_counter_entity_1.LocalIdCounter, outbox_entity_1.OutboxEntity]),
            tenancy_module_1.TenancyModule,
        ],
        controllers: [members_controller_1.MembersController, member_identifiers_controller_1.MemberIdentifiersController],
        providers: [members_service_1.MembersService, member_identifiers_service_1.MemberIdentifiersService, local_id_service_1.LocalIdService, outbox_service_1.OutboxService],
        exports: [members_service_1.MembersService, member_identifiers_service_1.MemberIdentifiersService, local_id_service_1.LocalIdService],
    })
], MembersModule);
//# sourceMappingURL=members.module.js.map