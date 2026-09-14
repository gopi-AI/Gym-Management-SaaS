import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Member } from './entities/member.entity';
import { MemberIdentifier } from './entities/member-identifier.entity';
import { MemberProfile } from './entities/member-profile.entity';
import { LocalIdCounter } from './entities/local-id-counter.entity';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { MembersService } from './services/members.service';
import { MemberIdentifiersService } from './services/member-identifiers.service';
import { LocalIdService } from './services/local-id.service';
import { MembersController } from './controllers/members.controller';
import { MemberIdentifiersController } from './controllers/member-identifiers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Member, MemberIdentifier, MemberProfile, LocalIdCounter]),
    OutboxModule,
    TenancyModule,
  ],
  controllers: [MembersController, MemberIdentifiersController],
  providers: [MembersService, MemberIdentifiersService, LocalIdService],
  exports: [MembersService, MemberIdentifiersService, LocalIdService],
})
export class MembersModule {}
