import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { IdentityUser } from '../entities/identity-users.entity';
export declare class AuthService {
    private readonly configService;
    private readonly jwtService;
    private readonly userRepository;
    constructor(configService: ConfigService, jwtService: JwtService, userRepository: Repository<IdentityUser>);
    validateUser(email: string, password: string): Promise<IdentityUser | null>;
    login(user: IdentityUser): Promise<{
        accessToken: string;
    }>;
    refreshToken(userId: string): Promise<{
        accessToken: string;
    }>;
}
//# sourceMappingURL=auth.service.d.ts.map