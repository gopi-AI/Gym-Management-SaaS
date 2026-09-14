import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { AttendanceEvent } from './entities/attendance-event.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AttendanceAccessDecision } from './entities/attendance-access-decision.entity';
import { AttendanceService } from './services/attendance.service';
import { AttendanceController } from './controllers/attendance.controller';

/**
 * Attendance (Phase 1): manual front-desk check-in/check-out with an access
 * decision audit trail.
 *
 * This module deliberately owns no membership rules: eligibility is read from
 * `MembershipsModule` (`MembershipsService.getCheckInEligibility`), which is the
 * single owner of the membership state machine.
 *
 * Phase 1 scope: `ATTENDANCE_ATTENDANCE_EVENTS`, `ATTENDANCE_ATTENDANCE_RECORDS`
 * and `ATTENDANCE_ACCESS_DECISIONS` only. The device-facing tables in
 * `docs/database-plan.md` (`ATTENDANCE_DEVICE_MAPPINGS`,
 * `ATTENDANCE_ELIGIBILITY_SNAPSHOTS`) are not created yet: nothing in Phase 1
 * writes them (no turnstile/reader integration), and shipping empty schema would
 * be dead weight. They arrive with the Phase 2 edge-sync work, which also adds
 * the documented `GET /v1/attendance/eligibility-snapshots` endpoint.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AttendanceEvent, AttendanceRecord, AttendanceAccessDecision]),
    OutboxModule,
    TenancyModule,
    MembershipsModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService, TypeOrmModule],
})
export class AttendanceModule {}
