import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MfaService } from './services/mfa.service';
import { IdentityUser } from './entities/identity-users.entity';
import { IdentityMfaSecret } from './entities/identity-mfa-secrets.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([IdentityUser, IdentityMfaSecret]),
  ],
  providers: [MfaService],
  exports: [MfaService],
})
export class IdentityMfaModule {}
