import { Repository } from 'typeorm';
import { MemberIdentifier } from '../entities/member-identifier.entity';
import { CreateMemberIdentifierDto } from '../dto/create-member-identifier.dto';
import { MembersService } from './members.service';
export declare class MemberIdentifiersService {
    private readonly identifierRepository;
    private readonly membersService;
    constructor(identifierRepository: Repository<MemberIdentifier>, membersService: MembersService);
    findAllByMember(memberId: string): Promise<MemberIdentifier[]>;
    create(memberId: string, dto: CreateMemberIdentifierDto): Promise<MemberIdentifier>;
    remove(memberId: string, identifierId: string): Promise<void>;
}
//# sourceMappingURL=member-identifiers.service.d.ts.map