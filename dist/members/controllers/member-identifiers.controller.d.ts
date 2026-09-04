import { MemberIdentifiersService } from '../services/member-identifiers.service';
import { CreateMemberIdentifierDto } from '../dto/create-member-identifier.dto';
export declare class MemberIdentifiersController {
    private readonly identifiersService;
    constructor(identifiersService: MemberIdentifiersService);
    findAll(memberId: string): Promise<import("../entities/member-identifier.entity").MemberIdentifier[]>;
    create(memberId: string, dto: CreateMemberIdentifierDto): Promise<import("../entities/member-identifier.entity").MemberIdentifier>;
    remove(memberId: string, identifierId: string): Promise<void>;
}
//# sourceMappingURL=member-identifiers.controller.d.ts.map