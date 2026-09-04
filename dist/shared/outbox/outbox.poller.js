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
exports.OutboxPoller = void 0;
const common_1 = require("@nestjs/common");
const outbox_service_1 = require("./outbox.service");
let OutboxPoller = class OutboxPoller {
    constructor(outboxService) {
        this.outboxService = outboxService;
    }
    async onModuleInit() {
        // In a production application, this would be triggered by a scheduled job/cron
        // For now, we'll find and process unprocessed events
        const unprocessed = await this.outboxService.findUnprocessedEvents();
        for (const event of unprocessed) {
            // Process the event - in a real app, this would publish to RabbitMQ
            console.log(`Processing outbox event: ${event.eventType}, Correlation ID: ${event.correlationId}`);
            // Mark as processed after successful processing
            await this.outboxService.markAsProcessed(event.id);
        }
    }
};
exports.OutboxPoller = OutboxPoller;
exports.OutboxPoller = OutboxPoller = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [outbox_service_1.OutboxService])
], OutboxPoller);
//# sourceMappingURL=outbox.poller.js.map