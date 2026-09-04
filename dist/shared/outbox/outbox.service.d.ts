import { Repository } from 'typeorm';
import { OutboxEntity } from './outbox.entity';
export declare class OutboxService {
    private readonly outboxRepository;
    constructor(outboxRepository: Repository<OutboxEntity>);
    findUnprocessedEvents(): Promise<OutboxEntity[]>;
    markAsProcessed(id: string): Promise<void>;
    saveEvent(eventType: string, payload: string, correlationId: string): Promise<OutboxEntity>;
}
//# sourceMappingURL=outbox.service.d.ts.map