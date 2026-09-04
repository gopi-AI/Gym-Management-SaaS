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
exports.InboxService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const inbox_entity_1 = require("./inbox.entity");
let InboxService = class InboxService {
    constructor(inboxRepository) {
        this.inboxRepository = inboxRepository;
    }
    async findProcessedEvent(correlationId) {
        return this.inboxRepository.findOne({
            where: { correlationId, handled: true },
        });
    }
    async markAsHandled(correlationId) {
        await this.inboxRepository.update(correlationId, { handled: true });
    }
    async saveEvent(correlationId, eventType, payload) {
        const exists = await this.findProcessedEvent(correlationId);
        if (exists) {
            return exists;
        }
        const event = this.inboxRepository.create({
            correlationId,
            eventType,
            payload,
            handled: false,
        });
        return this.inboxRepository.save(event);
    }
};
exports.InboxService = InboxService;
exports.InboxService = InboxService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(inbox_entity_1.InboxEntity)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], InboxService);
//# sourceMappingURL=inbox.service.js.map