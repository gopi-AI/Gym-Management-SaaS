import { Repository, DataSource } from 'typeorm';
import { Member } from '../entities/member.entity';
import { CreateMemberDto } from '../dto/create-member.dto';
import { UpdateMemberDto } from '../dto/update-member.dto';
import { ListMembersDto } from '../dto/list-members.dto';
import { LocalIdService } from './local-id.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
export declare class MembersService {
    private readonly memberRepository;
    private readonly dataSource;
    private readonly localIdService;
    private readonly tenantContextService;
    private readonly outboxService;
    constructor(memberRepository: Repository<Member>, dataSource: DataSource, localIdService: LocalIdService, tenantContextService: TenantContextService, outboxService: OutboxService);
    getOrganizationId(): Promise<string>;
    findAll(query: ListMembersDto): Promise<{
        data: Member[];
        total: number;
        page: number;
        limit: number;
    }>;
    findOne(id: string): Promise<Member>;
    findByLocalId(localId: number): Promise<Member | null>;
    private ensureNoDuplicateContact;
    create(dto: CreateMemberDto): Promise<Member>;
    update(id: string, dto: UpdateMemberDto): Promise<Member>;
    softDelete(id: string): Promise<void>;
}
//# sourceMappingURL=members.service.d.ts.map