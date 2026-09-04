import { DataSource, Repository } from 'typeorm';
import { LocalIdCounter } from '../entities/local-id-counter.entity';
export declare class LocalIdService {
    private readonly counterRepository;
    private readonly dataSource;
    constructor(counterRepository: Repository<LocalIdCounter>, dataSource: DataSource);
    /**
     * Generate the next unique local_id for a given organization.
     * Uses a transaction with row-level locking to prevent race conditions.
     */
    nextLocalId(organizationId: string): Promise<number>;
}
//# sourceMappingURL=local-id.service.d.ts.map