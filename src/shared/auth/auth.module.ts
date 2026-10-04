import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { buildJwtSecretOptions } from './jwt-secret';
import { IdentityModule } from '../../identity/identity.module';

@Global()
@Module({
  imports: [
    IdentityModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // The secret rule (development fallback only in development/test) is the
      // shared `jwt-secret.ts` one; this factory is a thin adapter over it.
      useFactory: (config: ConfigService) => buildJwtSecretOptions(config),
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtModule],
})
export class AuthModule {}