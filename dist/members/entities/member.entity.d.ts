import { MemberIdentifier } from './member-identifier.entity';
import { MemberProfile } from './member-profile.entity';
export declare class Member {
    id: string;
    organization_id: string;
    branch_id: string;
    global_uuid: string;
    local_id: number;
    first_name: string;
    last_name: string;
    middle_name?: string;
    preferred_name?: string;
    date_of_birth?: Date;
    gender?: string;
    phone?: string;
    email?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    created_at: Date;
    updated_at: Date;
    is_active: boolean;
    identifiers: MemberIdentifier[];
    profiles: MemberProfile[];
}
//# sourceMappingURL=member.entity.d.ts.map