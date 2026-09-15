import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Member } from './entities/member.entity';
import { MemberIdentifier } from './entities/member-identifier.entity';
import { MemberProfile } from './entities/member-profile.entity';
import { LocalIdCounter } from './entities/local-id-counter.entity';
import { MeasurementLog } from './entities/measurement-log.entity';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { MembersService } from './services/members.service';
import { MemberIdentifiersService } from './services/member-identifiers.service';
import { LocalIdService } from './services/local-id.service';
import { MeasurementLogsService } from './services/measurement-logs.service';
import { MembersController } from './controllers/members.controller';
import { MemberIdentifiersController } from './controllers/member-identifiers.controller';
import { MeasurementsController } from './controllers/measurements.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Member,
      MemberIdentifier,
      MemberProfile,
      LocalIdCounter,
      MeasurementLog,
    ]),
    OutboxModule,
    TenancyModule,
  ],
  controllers: [
    MembersController,
    MemberIdentifiersController,
    MeasurementsController,
  ],
  providers: [
    MembersService,
    MemberIdentifiersService,
    LocalIdService,
    MeasurementLogsService,
  ],
  // Only the SERVICE is exported — never the MeasurementLog repository. This enforces
  // the single-legal-write-path guarantee: no other module can bypass the dual-write
  // by injecting MeasurementLogRepository directly.
  exports: [MembersService, MemberIdentifiersService, LocalIdService, MeasurementLogsService],
})
export class MembersModule {}
