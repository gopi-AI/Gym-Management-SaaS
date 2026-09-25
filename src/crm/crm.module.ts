import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { MembersModule } from '../members/members.module';
import { Lead } from './entities/lead.entity';
import { LeadSource } from './entities/lead-source.entity';
import { LeadStage } from './entities/lead-stage.entity';
import { LeadActivity } from './entities/lead-activity.entity';
import { Conversion } from './entities/conversion.entity';
import { FollowUp } from './entities/follow-up.entity';
import { SlaPolicy } from './entities/sla-policy.entity';
import { SlaBreach } from './entities/sla-breach.entity';
import { CrmService } from './services/crm.service';
import { FollowUpsService } from './services/follow-ups.service';
import { SlaService } from './services/sla.service';
import { CrmController } from './controllers/crm.controller';
import { FollowUpsController } from './controllers/follow-ups.controller';
import { SlaController } from './controllers/sla.controller';

/**
 * CRM bounded context — P3-06 (lead management) and P3-07 (follow-ups & SLAs).
 *
 * P3-07 adds `CRM_FOLLOW_UPS`, `CRM_SLA_POLICIES` and `CRM_SLA_BREACHES` plus the
 * two services and two controllers that own them. `FollowUpsService` and
 * `SlaService` are exported because `WorkersModule` drives them from
 * `CrmFollowUpsWorker` / `CrmSlaMonitorWorker` — the §11 pattern that "modules
 * export services, never repositories".
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lead,
      LeadSource,
      LeadStage,
      LeadActivity,
      Conversion,
      FollowUp,
      SlaPolicy,
      SlaBreach,
    ]),
    TenancyModule,
    OutboxModule,
    MembersModule,
  ],
  controllers: [CrmController, FollowUpsController, SlaController],
  providers: [CrmService, FollowUpsService, SlaService],
  exports: [CrmService, FollowUpsService, SlaService],
})
export class CrmModule {}
