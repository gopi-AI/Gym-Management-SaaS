import { Repository } from 'typeorm';
import { InboxEntity } from './inbox.entity';
export declare class InboxService {
    private readonly inboxRepository;
    constructor(inboxRepository: Repository<InboxEntity>);
    findProcessedEvent(correlationId: string): Promise<InboxEntity | null>;
    markAsHandled(correlationId: string): Promise<void>;
    saveEvent(correlationId: string, eventType: string, payload: string): Promise<InboxEntity>;
}
//# sourceMappingURL=inbox.service.d.ts.map