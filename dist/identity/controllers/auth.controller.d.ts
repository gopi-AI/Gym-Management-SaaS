import { IdentityUser } from '../entities/identity-users.entity';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
export declare class AuthController {
    constructor();
    register(dto: RegisterDto): Promise<IdentityUser>;
    login(dto: LoginDto): Promise<{
        accessToken: string;
    }>;
    refresh(dto: RefreshTokenDto): Promise<{
        accessToken: string;
    }>;
}
//# sourceMappingURL=auth.controller.d.ts.map