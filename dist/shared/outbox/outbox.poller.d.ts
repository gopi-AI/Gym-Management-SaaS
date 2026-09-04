import { OnModuleInit } from '@nestjs/common';
import { OutboxService } from './outbox.service';
export declare class OutboxPoller implements OnModuleInit {
    private readonly outboxService;
    constructor(outboxService: OutboxService);
    onModuleInit(): Promise<void>;
}
//# sourceMappingURL=outbox.poller.d.ts.map