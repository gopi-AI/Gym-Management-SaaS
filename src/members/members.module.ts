import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Member } from './entities/member.entity';
import { MemberIdentifier } from './entities/member-identifier.entity';
import { MemberProfile } from './entities/member-profile.entity';
import { LocalIdCounter } from './entities/local-id-counter.entity';
import { MeasurementLog } from './entities/measurement-log.entity';
import { MemberConsent } from './entities/consent-log.entity';
import { MemberDocument } from './entities/member-document.entity';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { S3Module } from '../shared/storage/s3.module';
import { MembersService } from './services/members.service';
import { MemberIdentifiersService } from './services/member-identifiers.service';
import { LocalIdService } from './services/local-id.service';
import { MeasurementLogsService } from './services/measurement-logs.service';
import { ConsentsService } from './services/consents.service';
import { DocumentsService } from './services/documents.service';
import { MembersController } from './controllers/members.controller';
import { MemberIdentifiersController } from './controllers/member-identifiers.controller';
import { MeasurementsController } from './controllers/measurements.controller';
import { ConsentsController } from './controllers/consents.controller';
import { DocumentsController } from './controllers/documents.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Member,
      MemberIdentifier,
      MemberProfile,
      LocalIdCounter,
      MeasurementLog,
      MemberConsent,
      MemberDocument,
    ]),
    OutboxModule,
    S3Module,
    TenancyModule,
  ],
  controllers: [
    MembersController,
    MemberIdentifiersController,
    MeasurementsController,
    ConsentsController,
    DocumentsController,
  ],
  providers: [
    MembersService,
    MemberIdentifiersService,
    LocalIdService,
    MeasurementLogsService,
    ConsentsService,
    DocumentsService,
  ],
  // Only the SERVICES are exported — never the repositories. This enforces
  // the single-legal-write-path guarantee: no other module can bypass the
  // service-layer logic by injecting a repository directly.
  exports: [
    MembersService,
    MemberIdentifiersService,
    LocalIdService,
    MeasurementLogsService,
    ConsentsService,
    DocumentsService,
  ],
})
export class MembersModule {}
