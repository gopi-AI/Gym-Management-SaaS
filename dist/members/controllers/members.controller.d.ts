import { MembersService } from '../services/members.service';
import { CreateMemberDto } from '../dto/create-member.dto';
import { UpdateMemberDto } from '../dto/update-member.dto';
import { ListMembersDto } from '../dto/list-members.dto';
export declare class MembersController {
    private readonly membersService;
    constructor(membersService: MembersService);
    findAll(query: ListMembersDto): Promise<{
        data: import("../entities/member.entity").Member[];
        total: number;
        page: number;
        limit: number;
    }>;
    findOne(id: string): Promise<import("../entities/member.entity").Member>;
    create(dto: CreateMemberDto): Promise<import("../entities/member.entity").Member>;
    update(id: string, dto: UpdateMemberDto): Promise<import("../entities/member.entity").Member>;
}
//# sourceMappingURL=members.controller.d.ts.map