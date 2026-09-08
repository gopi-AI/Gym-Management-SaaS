import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { IdentityModule } from '../../identity/identity.module';

@Global()
@Module({
  imports: [
    IdentityModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret === 'dev-secret-change-me') {
          if (config.get<string>('NODE_ENV') === 'production') {
            throw new Error('JWT_SECRET must be set in production');
          }
        }
        return {
          secret: secret || 'dev-secret-change-me',
          signOptions: {
            expiresIn: config.get<string>('JWT_EXPIRATION', '3600s'),
          },
        };
      },
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtModule],
})
export class AuthModule {}