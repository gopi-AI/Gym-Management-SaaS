import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityUser } from './entities/identity-users.entity';
import { IdentityRole } from './entities/identity-roles.entity';
import { IdentityPermission } from './entities/identity-permissions.entity';
import { IdentityUserRole } from './entities/identity-user-roles.entity';
import { IdentityRolePermission } from './entities/identity-role-permissions.entity';
import { IdentityAuthToken } from './entities/identity-auth-tokens.entity';
import { IdentityMfaSecret } from './entities/identity-mfa-secrets.entity';
import { IdentityService } from './services/identity.service';
import { AuthService } from './services/auth.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    IdentityUser,
    IdentityRole,
    IdentityPermission,
    IdentityUserRole,
    IdentityRolePermission,
    IdentityAuthToken,
    IdentityMfaSecret,
  ])],
  providers: [IdentityService, AuthService],
  controllers: [],
  exports: [TypeOrmModule, IdentityService, AuthService],
})
export class IdentityModule {}